"""A restricted arithmetic calculator — no eval, imports, names, or calls."""
from __future__ import annotations

import ast
import operator
from typing import Any


class CalculationError(ValueError):
    """The expression is invalid or outside the intentionally small grammar."""


_BINARY = {
    ast.Add: operator.add,
    ast.Sub: operator.sub,
    ast.Mult: operator.mul,
    ast.Div: operator.truediv,
    ast.FloorDiv: operator.floordiv,
    ast.Mod: operator.mod,
    ast.Pow: operator.pow,
}
_UNARY = {ast.UAdd: operator.pos, ast.USub: operator.neg}
_MAX_LENGTH = 200
_MAX_ABS_VALUE = 10**100
_MAX_POWER = 100


def _evaluate(node: ast.AST) -> int | float:
    if isinstance(node, ast.Constant) and isinstance(node.value, (int, float)) and not isinstance(node.value, bool):
        value = node.value
    elif isinstance(node, ast.UnaryOp) and type(node.op) in _UNARY:
        value = _UNARY[type(node.op)](_evaluate(node.operand))
    elif isinstance(node, ast.BinOp) and type(node.op) in _BINARY:
        left, right = _evaluate(node.left), _evaluate(node.right)
        if isinstance(node.op, ast.Pow) and abs(right) > _MAX_POWER:
            raise CalculationError("Exponent is too large")
        try:
            value = _BINARY[type(node.op)](left, right)
        except ZeroDivisionError as exc:
            raise CalculationError("Division by zero") from exc
    else:
        raise CalculationError("Only numbers and +, -, *, /, //, %, **, and parentheses are allowed")
    if not isinstance(value, (int, float)) or isinstance(value, bool) or abs(value) > _MAX_ABS_VALUE:
        raise CalculationError("Result is outside the allowed range")
    return value


def calculate(expression: str) -> dict[str, Any]:
    expression = (expression or "").strip()
    if not expression:
        raise CalculationError("An expression is required")
    if len(expression) > _MAX_LENGTH:
        raise CalculationError(f"Expression is limited to {_MAX_LENGTH} characters")
    try:
        tree = ast.parse(expression, mode="eval")
    except SyntaxError as exc:
        raise CalculationError("Invalid arithmetic expression") from exc
    result = _evaluate(tree.body)
    return {"expression": expression, "result": result}


def calculator_tool(arguments: dict[str, Any]) -> dict[str, Any]:
    expression = arguments.get("expression")
    if not isinstance(expression, str):
        raise CalculationError("expression must be a string")
    return calculate(expression)
