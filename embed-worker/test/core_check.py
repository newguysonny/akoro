"""Pure-core checks for the embedding worker (no torch needed)."""
import os, sys
sys.path.insert(0, os.path.join(os.path.dirname(__file__), ".."))
from embedcore import BadInput, batches, parse_input, with_instruction, MAX_TEXTS

def raises(fn):
    try:
        fn()
    except BadInput:
        return True
    return False

texts, dims, ins = parse_input({"input": "hello"})
assert texts == ["hello"] and dims == 1024 and ins == "", (texts, dims, ins)
texts, dims, _ = parse_input({"input": ["a", "  "], "dimensions": 512})
assert texts == ["a", " "] and dims == 512
assert raises(lambda: parse_input({"input": []}))
assert raises(lambda: parse_input({"input": [1]}))
assert raises(lambda: parse_input({"input": ["x"] * (MAX_TEXTS + 1)}))
assert raises(lambda: parse_input({"input": "x", "dimensions": 1536})), "the 0.6B model gives at most 1024"
assert raises(lambda: parse_input({"input": "x", "dimensions": 16}))
assert with_instruction(["q"], "Find passages") == ["Instruct: Find passages\nQuery:q"]
assert with_instruction(["d"], "") == ["d"]
assert [len(b) for b in batches(list(range(5)), 2)] == [2, 2, 1]
print("CORE-CHECK: all passed")
