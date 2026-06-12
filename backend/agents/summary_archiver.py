import json
from typing import Optional

from backend.agents.base_agent import BaseAgent, LLMResponse


class SummaryArchiver(BaseAgent):
    """Tier 3 Agent — 使用轻量模型生成章摘要和 L1 重提取"""

    async def archive_chapter(
        self,
        chapter_number: int,
        scene_drafts: list[str],
        sf_logs: list[dict],
        character_states: dict,
    ) -> dict:
        drafts_text = "\n\n---\n\n".join(
            f"## Scene {i + 1}\n{draft}" for i, draft in enumerate(scene_drafts)
        )

        sf_logs_summary = json.dumps(
            [
                {"type": log.get("type", ""), "params": log.get("params", {})}
                for log in sf_logs
            ],
            ensure_ascii=False,
            indent=2,
        )

        char_states_text = json.dumps(character_states, ensure_ascii=False, indent=2)

        result, response = await self.generate_from_template(
            "chapter_summary",
            scene_drafts=drafts_text,
            sf_logs_summary=sf_logs_summary,
            character_states=char_states_text,
        )
        self.log_usage("chapter_summary", response)
        return result

    async def reextract_l1_details(
        self,
        chapter_range: tuple[int, int],
        scene_drafts: list[str],
    ) -> list[dict]:
        """每 5 章触发一次，从最近 N 章中提取关键细节补充到 L1"""
        start, end = chapter_range
        drafts_text = "\n\n---\n\n".join(scene_drafts)

        system_prompt = (
            "你是一个专业的小说编辑，需要从章节草稿中提取关键细节。"
            "只输出 JSON，不要输出其他内容。"
        )

        user_prompt = f"""请从以下第{start}-{end}章的草稿中提取关键细节。

## 章节草稿
{drafts_text}

输出 JSON 格式：
{{
  "character_details": [
    {{"name": "角色名", "current_location": "位置", "emotional_state": "情绪", "key_traits_manifested": ["表现的特质"]}}
  ],
  "world_details": [
    {{"aspect": "世界观层面", "new_info": "新增信息", "source_chapter": 1}}
  ],
  "lingering_questions": ["读者仍有的疑问"],
  "important_objects": [{{"name": "物品名", "significance": "重要性", "last_mentioned_chapter": 1}}]
}}"""

        result, response = await self.generate(
            system_prompt=system_prompt,
            user_prompt=user_prompt,
            json_mode=True,
        )
        self.log_usage("l1_reextraction", response)
        return result
