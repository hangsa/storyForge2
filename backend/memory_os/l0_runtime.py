from backend.config import settings


class L0Runtime:
    """L0 Runtime memory — always in context, ~500 tokens max."""

    MAX_TOKENS = 500

    def __init__(self):
        self._entries: list[dict] = []

    def update_from_logs(self, character_updates: dict) -> None:
        for char_name, updates in character_updates.items():
            entry = {"character": char_name}
            entry.update(updates)
            self._entries.append(entry)

    def set_scene_context(self, scene_number: int, scene_goal: str) -> None:
        self._scene_number = scene_number
        self._scene_goal = scene_goal

    def get_context_string(self) -> str:
        parts = []
        if hasattr(self, "_scene_number"):
            parts.append(f"当前场景: 第{self._scene_number}幕")
        if hasattr(self, "_scene_goal"):
            parts.append(f"目标: {self._scene_goal}")

        if self._entries:
            latest = self._entries[-1]
            for char, state in latest.items():
                if isinstance(state, dict):
                    loc = state.get("location", "")
                    emo = state.get("emotion", "")
                    parts.append(f"角色 {char}: 位置={loc}, 情绪={emo}")
                else:
                    parts.append(f"{char}: {state}")

        return "\n".join(parts)[: self.MAX_TOKENS * 2]

    def reset(self) -> None:
        self._entries.clear()
