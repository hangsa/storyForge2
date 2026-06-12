class L1Hot:
    """L1 Hot memory — last chapter scenes, stored separately for context assembly."""

    MAX_SCENES = 6

    def __init__(self):
        self._scenes: list[dict] = []

    def append_scene(
        self, scene_number: int, draft_text: str, summary: str = "",
        chapter_number: int = 1,
    ) -> None:
        self._scenes.append({
            "chapter_number": chapter_number,
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
            cn = s.get("chapter_number", 1)
            sn = s.get("scene_number", "?")
            summary = s.get("summary", "")
            if summary:
                parts.append(f"第{cn}章第{sn}幕: {summary}")
            else:
                text = s.get("draft_text", "")
                parts.append(f"第{cn}章第{sn}幕: {text[:200]}...")

        return "\n".join(parts)

    def get_previous_scenes_text(self) -> list[str]:
        return [s.get("draft_text", "") for s in self._scenes]

    def trim_to_last_n_chapters(self, n: int = 5) -> int:
        """裁剪 L1 至仅保留最近 n 章的 Scene drafts。返回删除的 scene 数量。"""
        if not self._scenes:
            return 0

        # Group scenes by chapter_number
        chapter_set = sorted(set(s.get("chapter_number", 1) for s in self._scenes))
        if len(chapter_set) <= n:
            return 0

        min_keep_chapter = chapter_set[-n]
        before = len(self._scenes)
        self._scenes = [
            s for s in self._scenes
            if s.get("chapter_number", 1) >= min_keep_chapter
        ]
        return before - len(self._scenes)

    def get_token_estimate(self) -> int:
        """估算当前 L1 总 token 数（中文 ~1.5 chars/token）"""
        total_chars = sum(len(s.get("draft_text", "")) for s in self._scenes)
        total_chars += sum(len(s.get("summary", "")) for s in self._scenes)
        return max(1, int(total_chars / 1.5))

    def reset(self) -> None:
        self._scenes.clear()
