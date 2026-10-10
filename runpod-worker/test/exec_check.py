"""Stub torch/transformers/PIL, import the real handler, run ONE job
through the real processor-call line. Any handler-level exception exits 1."""
import sys, types, os

# no cache at first → exercises the readable no-cache error path
os.environ["HF_HUB_CACHE"] = os.path.join("/tmp", f"hexec-{os.getpid()}", "empty-hub")

class _SL:
    @staticmethod
    def start(cfg): pass
runpod = types.ModuleType("runpod"); runpod.serverless = _SL
sys.modules["runpod"] = runpod

torch = types.ModuleType("torch")
torch.sys = sys
def inference_mode():
    class _C:
        def __enter__(self): return self
        def __exit__(self, *a): return False
    return _C()
torch.inference_mode = inference_mode
class cuda:
    @staticmethod
    def is_available(): return False
torch.cuda = cuda
sys.modules["torch"] = torch

class _Img:
    size = (8, 8)
    def convert(self, m): return self
    def resize(self, s, r=None): return self
    def save(self, buf, format=None): buf.write(b"x")
class Image:
    Image = _Img
    LANCZOS = 1
    @staticmethod
    def open(*a, **k): return _Img()
PIL = types.ModuleType("PIL"); PIL.Image = Image
sys.modules["PIL"] = PIL

seen = {}
class _Inputs:
    device = "cpu"
    def to(self, d): return self
    def __getitem__(self, k): return self
    @property
    def shape(self): return (1, 4)
    def keys(self): return ["input_ids"]
class _Model:
    device = "cpu"
    @staticmethod
    def from_pretrained(*a, **k): return _Model()
    def eval(self): return self
    def generate(self, **k): return [[1, 2, 3, 4]]
TEMPLATE = {"mode": "ok"}
class _Proc:
    @staticmethod
    def from_pretrained(*a, **k): return _Proc()
    def apply_chat_template(self, messages, tokenize=False, add_generation_prompt=False):
        seen["messages"] = messages
        seen["add_generation_prompt"] = add_generation_prompt
        if TEMPLATE["mode"] == "missing":
            raise ValueError("no chat template")
        text = messages[0]["content"][1]["text"]
        return f"<|im_start|>user\n<|vision_start|><|image_pad|><|vision_end|>{text}<|im_end|>\n<|im_start|>assistant\n"
    def __call__(self, text=None, images=None, return_tensors=None):
        seen["text"] = text
        return _Inputs()
    @staticmethod
    def decode(*a, **k): return '[{"bbox_2d":[1,2,3,4],"text_content":"hi"}]'
tf = types.ModuleType("transformers")
tf.AutoProcessor = _Proc
tf.AutoModelForImageTextToText = _Model
sys.modules["transformers"] = tf

sys.path.insert(0, os.path.join(os.path.dirname(os.path.abspath(__file__)), ".."))
import handler as H

# 1 · no cache → the readable per-job error (never a crash)
r = H.handler({"input": {"image_b64": "aGk="}})
assert "Model unavailable" in r.get("error", ""), r
print("EXEC-CHECK: no-cache path → readable error ✓")

# 2 · cache appears → the FULL path runs (this is the line v1.0.3 broke)
snap = os.path.join("/tmp", f"hexec-{os.getpid()}", "empty-hub", "models--hanji-dev--hanji-parse-4b", "snapshots", "abc")
os.makedirs(snap, exist_ok=True)
r = H.handler({"input": {"image_b64": "aGk="}})
assert "error" not in r, r
assert r["blocks"] == [{"bbox_2d": [1.0, 2.0, 3.0, 4.0], "text_content": "hi"}], r
assert r["generated_tokens"] == 0, r   # stub generate echoes the 4 prompt ids back
sent = seen["text"][0]
assert sent.startswith("<|im_start|>user\n<|vision_start|><|image_pad|><|vision_end|>Detect every BLOCK"), sent[:120]
assert sent.endswith("<|im_end|>\n<|im_start|>assistant\n"), sent[-60:]
assert seen["add_generation_prompt"] is True and seen["messages"][0]["content"][0] == {"type": "image"}, seen
print("EXEC-CHECK: full path → blocks out, chat-formatted prompt with the assistant turn opened ✓")

# 3 · a snapshot with no chat template → the hand-built Qwen layout
TEMPLATE["mode"] = "missing"
r = H.handler({"input": {"image_b64": "aGk="}})
assert "error" not in r, r
sent = seen["text"][0]
assert sent.startswith("<|im_start|>user\n<|vision_start|><|image_pad|><|vision_end|>Detect every BLOCK"), sent[:120]
assert sent.endswith("<|im_end|>\n<|im_start|>assistant\n"), sent[-60:]
print("EXEC-CHECK: no template → hand-built Qwen chat layout ✓")
print("EXEC-CHECK: all passed")
