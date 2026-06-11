class L1Hot:
    """L1 Hot memory — last chapter scenes, stored separately for context assembly."""

    MAX_SCENES = 6

    def __init__(self):
        self._scenes: list[dict] = []

    def append_scene(
        self, scene_number: int, draft_text: str, summary: str = ""
    ) -> None:
        self._scenes.append({
            "scene_number": scene_number,
            "draft_text": draft_text,
            "summary": summary,
        })
        if len(self._scenes) > self.MAX_SCENES:
            self._scenes = self._scenes[-self.MAX_SCENES:]

    def get_context_string(self) -> str:
        if not self._scenes:
            return "（这是第一章的第一幕）"

        parts = ["## 前文回顾"]
        for s in self._scenes:
            summary = s.get("summary", "")
            if summary:
                parts.append(f"第{s['scene_number']}幕: {summary}")
            else:
                text = s.get("draft_text", "")
                parts.append(f"第{s['scene_number']}幕: {text[:200]}...")

        return "\n".join(parts)

    def get_previous_scenes_text(self) -> list[str]:
        return [s.get("draft_text", "") for s in self._scenes]

    def reset(self) -> None:
        self._scenes.clear()
