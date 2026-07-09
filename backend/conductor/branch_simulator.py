"""Branch Simulator — 分支模拟引擎 (deterministic + LLM two-phase analysis)."""

import json
import logging
from datetime import datetime, timezone
from pathlib import Path
from typing import Optional

import yaml

from backend.models.branch_simulation import BranchSimulationReport, LLMInference

logger = logging.getLogger(__name__)


class BranchSimulator:

    def __init__(
        self,
        projects_dir: Path,
        model_router=None,
    ) -> None:
        self._projects_dir = Path(projects_dir)
        self._router = model_router

    async def simulate(
        self, project_id: str, branch_description: str
    ) -> BranchSimulationReport:
        det = self._run_deterministic(project_id, branch_description)
        llm = await self._run_llm_inference(project_id, branch_description, det)

        tokens_total = sum(
            inf.tokens_used for inf in [
                llm.get("tension"),
                llm.get("risk"),
                llm.get("alternatives"),
            ] if inf is not None
        )

        return BranchSimulationReport(
            branch_point_description=branch_description,
            affected_chapter_range=det["chapter_range"],
            affected_characters=det["characters"],
            affected_foreshadowings=det["foreshadowings"],
            growth_curve_shifts=det["growth_shifts"],
            reader_metrics_projection=det["reader_metrics"],
            tension_curve_projection=llm.get("tension"),
            foreshadowing_risk_assessment=llm.get("risk"),
            alternative_suggestions=llm.get("alternatives"),
            created_at=datetime.now(timezone.utc).isoformat(),
            tokens_used_total=tokens_total,
        )

    def _run_deterministic(
        self, project_id: str, description: str
    ) -> dict:
        project_dir = self._projects_dir / project_id
        if not project_dir.exists():
            return {
                "chapter_range": (1, 1),
                "characters": [],
                "foreshadowings": [],
                "growth_shifts": {},
                "reader_metrics": {},
            }

        # Extract character names from characters.json
        characters: list[str] = []
        chars_path = project_dir / "characters.json"
        if chars_path.exists():
            try:
                chars_data = json.loads(chars_path.read_text(encoding="utf-8"))
                chars_list = chars_data if isinstance(chars_data, list) else chars_data.get("characters", [])
                for c in chars_list:
                    name = c.get("name", "")
                    if name and name in description:
                        characters.append(name)
            except Exception as e:
                logger.warning("Failed to load characters.json from %s: %s", chars_path, e)

        # Determine chapter range from outline
        chapter_start, chapter_end = 1, 1
        outline_path = project_dir / "outline.json"
        if outline_path.exists():
            try:
                outline = json.loads(outline_path.read_text(encoding="utf-8"))
                chapters = outline.get("chapters", [])
                if chapters:
                    nums = [ch.get("chapter_number", 0) for ch in chapters if ch.get("chapter_number")]
                    if nums:
                        chapter_start = min(nums)
                        chapter_end = max(nums)
            except Exception as e:
                logger.warning("Failed to load outline.json from %s: %s", outline_path, e)

        # Extract foreshadowing IDs from StoryOS mystery registry, filtering
        # to only those affected by the branch description.
        foreshadowings: list[str] = []
        mystery_path = project_dir / "storyos" / "mystery.json"
        if mystery_path.exists():
            try:
                mystery_data = json.loads(mystery_path.read_text(encoding="utf-8"))
                mysteries = mystery_data if isinstance(mystery_data, list) else mystery_data.get("mysteries", [])
                for m in mysteries:
                    fid = m.get("id", "")
                    if not fid:
                        continue
                    # Collect searchable keywords from the mystery record
                    keywords: list[str] = []
                    for field in ("title", "description", "related_chapter"):
                        val = m.get(field, "")
                        if isinstance(val, str) and val:
                            keywords.append(val)
                    # Include this mystery if any keyword appears in the branch description
                    if any(kw in description for kw in keywords):
                        foreshadowings.append(fid)
            except Exception as e:
                logger.warning("Failed to load mystery.json from %s: %s", mystery_path, e)

        # Compute growth_curve shifts from characters.json
        growth_shifts: dict[str, int] = {}
        if chars_path.exists():
            try:
                chars_data = json.loads(chars_path.read_text(encoding="utf-8"))
                chars_list = chars_data if isinstance(chars_data, list) else chars_data.get("characters", [])
                for c in chars_list:
                    name = c.get("name", "")
                    growth_curve = c.get("growth_curve")
                    if not name or not growth_curve:
                        continue
                    stages = growth_curve.get("stages", [])
                    for stage in stages:
                        orig_ch = stage.get("chapter_number")
                        if isinstance(orig_ch, (int, float)) and orig_ch > 0:
                            midpoint = (chapter_start + chapter_end) / 2
                            offset = int(round(orig_ch - midpoint))
                            if offset != 0:
                                growth_shifts[name] = offset
                                break
            except Exception as e:
                logger.warning("Failed to read growth_curve from %s: %s", chars_path, e)

        return {
            "chapter_range": (chapter_start, chapter_end),
            "characters": characters,
            "foreshadowings": foreshadowings,
            "growth_shifts": growth_shifts,
            "reader_metrics": self._estimate_reader_metrics(description, characters),
        }

    def _estimate_reader_metrics(
        self, description: str, characters: list[str]
    ) -> dict[str, str]:
        metrics: dict[str, str] = {}
        tension_keywords = ["冲突", "战斗", "危机", "决战", "生死"]
        curiosity_keywords = ["秘密", "真相", "发现", "揭露", "谜"]
        if any(kw in description for kw in tension_keywords):
            metrics["tension"] = "↑10"
        if any(kw in description for kw in curiosity_keywords):
            metrics["curiosity"] = "↑5"
        if characters:
            metrics["satisfaction"] = "→"
        return metrics

    async def _run_llm_inference(
        self, project_id: str, description: str, det: dict
    ) -> dict:
        if self._router is None:
            return {}

        chapter_start, chapter_end = det["chapter_range"]
        chars_str = ", ".join(det["characters"]) if det["characters"] else "（无明确角色）"
        foreshadowings_str = ", ".join(det["foreshadowings"]) if det["foreshadowings"] else "（无已登记伏笔）"
        growth_str = json.dumps(det["growth_shifts"], ensure_ascii=False) if det["growth_shifts"] else "（无偏移）"
        metrics_str = json.dumps(det["reader_metrics"], ensure_ascii=False) if det["reader_metrics"] else "（无预测）"

        prompt_path = Path(__file__).parent.parent / "prompts" / "branch_simulation_llm.yaml"
        try:
            with open(prompt_path, encoding="utf-8") as f:
                prompt_config = yaml.safe_load(f)
            system_prompt = prompt_config["system_prompt"].strip()
            user_prompt_template = prompt_config["user_prompt_template"].strip()
            user_prompt = user_prompt_template.format(
                description=description,
                chapter_start=chapter_start,
                chapter_end=chapter_end,
                affected_characters=chars_str,
                affected_foreshadowings=foreshadowings_str,
                growth_shifts=growth_str,
                reader_metrics=metrics_str,
            )
        except Exception as e:
            logger.warning("Failed to load branch simulation LLM prompts from %s, using fallback: %s", prompt_path, e)
            system_prompt = (
                "你是一位叙事分析师，擅长评估故事分支变更对叙事结构的影响。\n\n"
                "你需要完成三项推理任务：\n"
                "1. 张力曲线预测：分析分支变更对故事张力曲线的影响\n"
                "2. 伏笔风险评估：评估哪些伏笔可能受影响或需要调整\n"
                "3. 替代方案建议：提出替代的分支方向\n\n"
                "每项任务需要标注置信度：high、medium 或 low。只输出JSON。"
            )
            user_prompt = (
                f"分支变更描述：{description}\n\n"
                f"当前故事状态：\n"
                f"- 影响章范围：第{chapter_start}章-第{chapter_end}章\n"
                f"- 受影响角色：{chars_str}\n"
                f"- 受影响伏笔：{foreshadowings_str}\n"
                f"- 成长曲线偏移：{growth_str}\n"
                f"- 读者指标预测：{metrics_str}\n\n"
                "请分析此分支变更的三项影响，输出JSON格式：\n"
                '{"tension_curve": {"content": "...", "confidence": "medium"}, '
                '"foreshadowing_risk": {"content": "...", "confidence": "medium"}, '
                '"alternative_suggestions": {"content": "...", "confidence": "high | medium | low"}}'
            )

        try:
            result = await self._router.execute(
                agent_name="creative_director",
                task_name="fusion_analysis",
                messages=[
                    {"role": "system", "content": system_prompt},
                    {"role": "user", "content": user_prompt},
                ],
                json_mode=True,
            )
        except Exception as e:
            logger.warning("Branch simulation LLM inference failed: %s", e)
            return {}

        content = result.get("content", "")
        if not content:
            return {}

        try:
            parsed = json.loads(content)
        except json.JSONDecodeError:
            logger.warning("Failed to parse branch simulation LLM JSON")
            return {}

        tokens = result.get("usage", {})
        tokens_used = tokens.get("input", 0) + tokens.get("output", 0)
        model = result.get("model", "unknown")

        def _build_inference(key: str) -> Optional[LLMInference]:
            item = parsed.get(key, {})
            if not item:
                return None
            return LLMInference(
                content=item.get("content", ""),
                confidence=item.get("confidence", "medium"),
                model=model,
                tokens_used=tokens_used,
            )

        return {
            "tension": _build_inference("tension_curve"),
            "risk": _build_inference("foreshadowing_risk"),
            "alternatives": _build_inference("alternative_suggestions"),
        }

    def save_report(
        self, project_id: str, report: BranchSimulationReport
    ) -> Path:
        branches_dir = self._projects_dir / project_id / "branches"
        branches_dir.mkdir(parents=True, exist_ok=True)
        ts = datetime.now(timezone.utc).strftime("%Y%m%dT%H%M%S")
        filename = f"{ts}_simulation.json"
        path = branches_dir / filename
        tmp = path.with_suffix(".tmp")
        data = {
            "branch_point_description": report.branch_point_description,
            "affected_chapter_range": list(report.affected_chapter_range),
            "affected_characters": report.affected_characters,
            "affected_foreshadowings": report.affected_foreshadowings,
            "growth_curve_shifts": report.growth_curve_shifts,
            "reader_metrics_projection": report.reader_metrics_projection,
            "created_at": report.created_at,
            "tokens_used_total": report.tokens_used_total,
        }
        if report.tension_curve_projection:
            data["tension_curve_projection"] = {
                "content": report.tension_curve_projection.content,
                "confidence": report.tension_curve_projection.confidence,
                "model": report.tension_curve_projection.model,
                "tokens_used": report.tension_curve_projection.tokens_used,
            }
        if report.foreshadowing_risk_assessment:
            data["foreshadowing_risk_assessment"] = {
                "content": report.foreshadowing_risk_assessment.content,
                "confidence": report.foreshadowing_risk_assessment.confidence,
                "model": report.foreshadowing_risk_assessment.model,
                "tokens_used": report.foreshadowing_risk_assessment.tokens_used,
            }
        if report.alternative_suggestions:
            data["alternative_suggestions"] = {
                "content": report.alternative_suggestions.content,
                "confidence": report.alternative_suggestions.confidence,
                "model": report.alternative_suggestions.model,
                "tokens_used": report.alternative_suggestions.tokens_used,
            }
        tmp.write_text(json.dumps(data, ensure_ascii=False, indent=2), encoding="utf-8")
        tmp.replace(path)
        return path

    def list_history(self, project_id: str) -> list[dict]:
        branches_dir = self._projects_dir / project_id / "branches"
        if not branches_dir.exists():
            return []
        results = []
        for f in sorted(branches_dir.glob("*_simulation.json"), reverse=True):
            try:
                data = json.loads(f.read_text(encoding="utf-8"))
                results.append({
                    "id": f.stem,
                    "description": data.get("branch_point_description", ""),
                    "created_at": data.get("created_at", ""),
                })
            except Exception as e:
                logger.warning("Failed to read simulation report %s: %s", f, e)
        return results
