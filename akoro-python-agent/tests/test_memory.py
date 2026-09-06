from __future__ import annotations

from pathlib import Path
from tempfile import TemporaryDirectory
import unittest

from agent.llm.messages import Message
from agent.memory.long_term import LongTermMemory
from agent.memory.short_term import ShortTermMemory


class MemoryTests(unittest.TestCase):
    def test_short_term_memory_is_bounded_and_omits_system_messages(self) -> None:
        memory = ShortTermMemory(max_messages=2)
        memory.extend([Message.system("ignore"), Message.user("first"), Message.assistant("second"), Message.user("third")])
        self.assertEqual([(message.role, message.content) for message in memory.messages()], [("assistant", "second"), ("user", "third")])

    def test_long_term_memory_persists_json_in_workspace(self) -> None:
        with TemporaryDirectory() as directory:
            workspace = Path(directory)
            memory = LongTermMemory(workspace)
            memory.remember("learner.preference", {"language": "English"})
            reread = LongTermMemory(workspace)
            self.assertEqual(reread.recall("learner.preference"), {"language": "English"})

    def test_long_term_memory_rejects_path_escape(self) -> None:
        with TemporaryDirectory() as directory:
            with self.assertRaises(ValueError):
                LongTermMemory(Path(directory), "../outside.json")
