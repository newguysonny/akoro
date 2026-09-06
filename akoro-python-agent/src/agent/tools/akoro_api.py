"""Safe, server-to-server adapter for the Akoro API tool gateway.

The Akoro API remains the source of truth for tool definitions, entitlements,
authorisation, validation, side effects, and idempotency. This module only
loads its per-session catalogue and relays bounded model requests; it never
holds browser credentials or independently authorises a student action.
"""
from __future__ import annotations

from collections.abc import Callable, Mapping
from dataclasses import dataclass, field
import json
import re
from typing import Any
from urllib.error import HTTPError, URLError
from urllib.request import Request, urlopen

from agent.llm.messages import ToolCall

_TOOL_NAME = re.compile(r"^[a-z][a-z0-9_]{0,79}$")
_MAX_CATALOGUE_TOOLS = 24
_MAX_DESCRIPTION_CHARS = 800
_MAX_SCHEMA_CHARS = 6_000
_MAX_ARGUMENT_BYTES = 12_000
_MAX_RESULT_CHARS = 12_000


class AkoroToolsError(RuntimeError):
    """The remote tools gateway rejected or could not fulfil a request."""


@dataclass(frozen=True, slots=True)
class AkoroToolDefinition:
    name: str
    description: str
    input_schema: dict[str, Any]
    side_effecting: bool = False
    max_calls: int = 1

    @classmethod
    def from_wire(cls, payload: Mapping[str, Any]) -> "AkoroToolDefinition":
        name = str(payload.get("name") or "").strip()
        if not _TOOL_NAME.fullmatch(name):
            raise ValueError("Akoro tool name is invalid")
        description = str(payload.get("description") or "").strip()[:_MAX_DESCRIPTION_CHARS]
        if not description:
            raise ValueError(f"Akoro tool {name!r} has no description")
        # Support Akoro's existing `input_schema` convention as well as the
        # camel-case contract used by the Python service.
        schema = payload.get("inputSchema", payload.get("input_schema"))
        if not isinstance(schema, dict) or schema.get("type") != "object":
            raise ValueError(f"Akoro tool {name!r} must provide an object input schema")
        try:
            schema_size = len(json.dumps(schema, separators=(",", ":"), ensure_ascii=False))
        except (TypeError, ValueError) as exc:
            raise ValueError(f"Akoro tool {name!r} input schema is not JSON") from exc
        if schema_size > _MAX_SCHEMA_CHARS:
            raise ValueError(f"Akoro tool {name!r} input schema is too large")
        try:
            max_calls = int(payload.get("maxCalls", payload.get("max_calls", 1)))
        except (TypeError, ValueError) as exc:
            raise ValueError(f"Akoro tool {name!r} maxCalls is invalid") from exc
        return cls(
            name=name,
            description=description,
            input_schema=dict(schema),
            side_effecting=bool(payload.get("sideEffecting", payload.get("side_effecting", False))),
            max_calls=max(1, min(max_calls, 6)),
        )

    def schema(self) -> dict[str, Any]:
        return {
            "type": "function",
            "function": {
                "name": self.name,
                "description": self.description,
                "parameters": self.input_schema,
                "strict": True,
            },
        }

    def public(self) -> dict[str, Any]:
        """Safe catalogue metadata suitable for the session-ready response."""
        return {
            "name": self.name,
            "description": self.description,
            "sideEffecting": self.side_effecting,
        }


@dataclass(frozen=True, slots=True)
class ToolExecution:
    name: str
    success: bool
    side_effecting: bool
    already_done: bool = False
    error: str | None = None

    def public(self) -> dict[str, Any]:
        value: dict[str, Any] = {
            "tool": self.name,
            "success": self.success,
            "sideEffecting": self.side_effecting,
        }
        if self.already_done:
            value["alreadyDone"] = True
        if self.error:
            value["error"] = self.error
        return value


Transport = Callable[[str, dict[str, Any], dict[str, str], float], dict[str, Any]]


def _https_post(url: str, payload: dict[str, Any], headers: dict[str, str], timeout: float) -> dict[str, Any]:
    encoded = json.dumps(payload, separators=(",", ":"), ensure_ascii=False).encode("utf-8")
    request = Request(url, data=encoded, method="POST", headers=headers)
    try:
        with urlopen(request, timeout=timeout) as response:  # nosec B310: configuration is explicitly HTTPS-validated.
            raw = response.read(_MAX_RESULT_CHARS * 4 + 1024)
    except HTTPError as exc:
        raise AkoroToolsError(f"Akoro tools API returned HTTP {exc.code}") from exc
    except (URLError, TimeoutError, OSError) as exc:
        raise AkoroToolsError("Akoro tools API is unavailable") from exc
    try:
        body = json.loads(raw.decode("utf-8"))
    except (UnicodeDecodeError, json.JSONDecodeError) as exc:
        raise AkoroToolsError("Akoro tools API returned invalid JSON") from exc
    if not isinstance(body, dict):
        raise AkoroToolsError("Akoro tools API response must be an object")
    return body


def _bound_value(value: Any, budget: int = _MAX_RESULT_CHARS) -> Any:
    """Limit untrusted tool output before it becomes an LLM context message."""
    if isinstance(value, str):
        return value[:budget]
    if value is None or isinstance(value, (bool, int, float)):
        return value
    if isinstance(value, list):
        return [_bound_value(item, max(256, budget // 8)) for item in value[:20]]
    if isinstance(value, dict):
        return {
            str(key)[:120]: _bound_value(item, max(256, budget // 8))
            for key, item in list(value.items())[:30]
        }
    return str(value)[:budget]


class AkoroToolsClient:
    """Transport client for the private Akoro tools API contract."""

    def __init__(self, base_url: str, secret: str, timeout_seconds: float = 12,
                 transport: Transport | None = None) -> None:
        self._base_url = base_url.rstrip("/")
        self._secret = secret
        self._timeout = timeout_seconds
        self._transport = transport or _https_post

    def open_session(self, session_id: str, tool_context: str, *, max_calls: int,
                     allow_side_effects: bool = False) -> "AkoroToolSession":
        if not tool_context:
            return AkoroToolSession.disabled("No Akoro tool context was supplied")
        response = self._post("/catalog", {"sessionId": session_id, "toolContext": tool_context})
        items = response.get("tools")
        if not isinstance(items, list):
            raise AkoroToolsError("Akoro tools API catalogue did not contain tools")
        definitions: dict[str, AkoroToolDefinition] = {}
        for item in items[:_MAX_CATALOGUE_TOOLS]:
            if not isinstance(item, Mapping):
                continue
            try:
                definition = AkoroToolDefinition.from_wire(item)
            except ValueError:
                # Fail closed for just the malformed catalogue item, retaining
                # independently valid tools rather than making teaching fail.
                continue
            definitions.setdefault(definition.name, definition)
        return AkoroToolSession(
            client=self,
            session_id=session_id,
            tool_context=tool_context,
            definitions=definitions,
            max_calls=max_calls,
            allow_side_effects=allow_side_effects,
        )

    def invoke(self, *, session_id: str, tool_context: str, name: str,
               arguments: dict[str, Any], idempotency_key: str) -> tuple[bool, Any, str | None]:
        try:
            encoded = json.dumps(arguments, separators=(",", ":"), ensure_ascii=False).encode("utf-8")
        except (TypeError, ValueError) as exc:
            raise AkoroToolsError("Tool arguments cannot be serialised") from exc
        if len(encoded) > _MAX_ARGUMENT_BYTES:
            raise AkoroToolsError("Tool arguments exceed the 12,000-byte limit")
        response = self._post("/invoke", {
            "sessionId": session_id,
            "toolContext": tool_context,
            "tool": name,
            "arguments": arguments,
            "idempotencyKey": idempotency_key[:180],
        })
        # Deliberately do not accept a generic `{data: ...}` wrapper here:
        # concrete `{success, result}` keeps a tool result distinct from a
        # transport envelope and makes the backend contract auditable.
        success = bool(response.get("success", False))
        error = str(response.get("error") or response.get("message") or "")[:500] or None
        result = response.get("result", {})
        bounded = _bound_value(result)
        # JSON size is bounded even if an unusually nested object evades the
        # individual container limits above.
        rendered = json.dumps(bounded, ensure_ascii=False)
        if len(rendered) > _MAX_RESULT_CHARS:
            bounded = {"truncated": True, "preview": rendered[:_MAX_RESULT_CHARS]}
        return success, bounded, error

    def _post(self, suffix: str, payload: dict[str, Any]) -> dict[str, Any]:
        return self._transport(
            f"{self._base_url}{suffix}",
            payload,
            {
                "Content-Type": "application/json",
                "Accept": "application/json",
                "X-Akoro-Tools-Secret": self._secret,
                "User-Agent": "Akoro-Python-Agent/0.4",
            },
            self._timeout,
        )


@dataclass(slots=True)
class AkoroToolSession:
    """Per-teaching-session catalogue, permissions, idempotency, and audit."""

    client: AkoroToolsClient | None
    session_id: str = ""
    tool_context: str = ""
    definitions: dict[str, AkoroToolDefinition] = field(default_factory=dict)
    max_calls: int = 4
    allow_side_effects: bool = False
    disabled_reason: str | None = None
    _calls: int = 0
    _calls_by_name: dict[str, int] = field(default_factory=dict)
    _completed_side_effects: dict[str, Any] = field(default_factory=dict)
    _executions: list[ToolExecution] = field(default_factory=list)

    @classmethod
    def disabled(cls, reason: str) -> "AkoroToolSession":
        return cls(client=None, disabled_reason=reason)

    @property
    def enabled(self) -> bool:
        return self.client is not None and bool(self.definitions)

    def schemas(self) -> list[dict[str, Any]]:
        return [definition.schema() for definition in self.definitions.values()]

    def public_catalogue(self) -> list[dict[str, Any]]:
        return [definition.public() for definition in self.definitions.values()]

    def drain_executions(self) -> list[dict[str, Any]]:
        executions = [execution.public() for execution in self._executions]
        self._executions.clear()
        return executions

    def invoke(self, call: ToolCall) -> dict[str, Any]:
        call_id = str(call.id or "").strip()
        if not call_id:
            return self._record(call.name, False, False, error="Tool call has no idempotency key")
        if not isinstance(call.arguments, dict):
            return self._record(call.name, False, False, error="Tool arguments must be an object")
        definition = self.definitions.get(call.name)
        if not self.client or not definition:
            return self._record(call.name, False, False, error="This tool is not available for this session")
        if self._calls >= self.max_calls:
            return self._record(call.name, False, definition.side_effecting, error="Tool-call limit reached for this teaching session")
        if self._calls_by_name.get(call.name, 0) >= definition.max_calls:
            return self._record(call.name, False, definition.side_effecting, error="This tool reached its per-session call limit")
        # A tool catalogue may include write-capable tools, but a teaching
        # session is read-only by default. This local defence is in addition
        # to (never a replacement for) Akoro API authorization.
        if definition.side_effecting and not self.allow_side_effects:
            return self._record(call.name, False, True, error="Side-effecting tools are disabled for this teaching session")
        if definition.side_effecting and call.name in self._completed_side_effects:
            value = self._completed_side_effects[call.name]
            self._executions.append(ToolExecution(call.name, True, True, already_done=True))
            return {"success": True, "alreadyDone": True, "result": value}

        self._calls += 1
        self._calls_by_name[call.name] = self._calls_by_name.get(call.name, 0) + 1
        try:
            success, result, error = self.client.invoke(
                session_id=self.session_id,
                tool_context=self.tool_context,
                name=call.name,
                arguments=call.arguments,
                idempotency_key=call_id,
            )
        except AkoroToolsError as exc:
            return self._record(call.name, False, definition.side_effecting, error=str(exc))
        self._executions.append(ToolExecution(call.name, success, definition.side_effecting, error=error))
        if success and definition.side_effecting:
            self._completed_side_effects[call.name] = result
        return {"success": success, "result": result, **({"error": error} if error else {})}

    def _record(self, name: str, success: bool, side_effecting: bool, *, error: str) -> dict[str, Any]:
        self._executions.append(ToolExecution(name, success, side_effecting, error=error))
        return {"success": success, "error": error}
