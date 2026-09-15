"""A bounded, best-effort public web search tool."""
from __future__ import annotations

from typing import Any
from urllib.parse import urlencode
from urllib.request import Request, urlopen
import json

_MAX_QUERY_LENGTH = 240
_MAX_RESULTS = 5


def _related_topics(items: list[Any]) -> list[dict[str, str]]:
    """Flatten DuckDuckGo's nested RelatedTopics response without trusting it."""
    found: list[dict[str, str]] = []
    for item in items:
        if not isinstance(item, dict):
            continue
        if isinstance(item.get("Topics"), list):
            found.extend(_related_topics(item["Topics"]))
            continue
        text, url = item.get("Text"), item.get("FirstURL")
        if isinstance(text, str) and isinstance(url, str):
            found.append({"title": text.split(" - ", 1)[0], "snippet": text, "url": url})
    return found


def search_web(arguments: dict[str, Any]) -> dict[str, Any]:
    query = arguments.get("query")
    if not isinstance(query, str) or not query.strip():
        raise ValueError("query must be a non-empty string")
    query = query.strip()
    if len(query) > _MAX_QUERY_LENGTH:
        raise ValueError(f"query is limited to {_MAX_QUERY_LENGTH} characters")

    endpoint = "https://api.duckduckgo.com/?" + urlencode({
        "q": query, "format": "json", "no_html": "1", "skip_disambig": "1",
    })
    request = Request(endpoint, headers={"User-Agent": "AkoroAgentFromScratch/0.1"})
    try:
        with urlopen(request, timeout=8) as response:  # nosec B310: fixed HTTPS endpoint
            payload = json.loads(response.read().decode("utf-8"))
    except Exception as exc:  # Network failure should be visible to the agent, not fatal.
        return {"query": query, "results": [], "error": f"Search unavailable: {exc}"}

    results: list[dict[str, str]] = []
    abstract = payload.get("AbstractText")
    abstract_url = payload.get("AbstractURL")
    heading = payload.get("Heading")
    if isinstance(abstract, str) and abstract and isinstance(abstract_url, str) and abstract_url:
        results.append({"title": heading if isinstance(heading, str) and heading else query, "snippet": abstract, "url": abstract_url})
    results.extend(_related_topics(payload.get("RelatedTopics", [])))
    return {"query": query, "results": results[:_MAX_RESULTS]}
