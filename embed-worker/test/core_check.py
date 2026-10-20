"""Pure-core checks for the embedding worker (no torch needed)."""
import os, sys
sys.path.insert(0, os.path.join(os.path.dirname(__file__), ".."))
from embedcore import BadInput, batches, model_profile, parse_input, with_instruction, MAX_TEXTS

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
qwen = model_profile("Qwen/Qwen3-Embedding-0.6B")
bge = model_profile("BAAI/bge-m3")
assert (qwen["pooling"], qwen["padding_side"]) == ("last", "left")
assert (bge["pooling"], bge["padding_side"]) == ("cls", "right")
try:
    model_profile("some/other-model"); assert False, "an unknown model is refused"
except ValueError:
    pass
assert parse_input({"input": "x"}, bge)[1] == 1024
assert raises(lambda: parse_input({"input": "x", "dimensions": 512}, bge)), "bge-m3 isn't trained to be cut"
assert parse_input({"input": "x", "instruction": "Find"}, bge)[2] == "", "bge-m3 has no instruction format"
assert parse_input({"input": "x", "instruction": "Find"}, qwen)[2] == "Find"
print("CORE-CHECK: all passed")
