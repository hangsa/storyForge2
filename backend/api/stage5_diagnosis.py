import json
import re
from pathlib import Path
from typing import Optional

from fastapi import APIRouter, HTTPException

from backend.config import settings
from backend.utils.file_manager import FileManager
from backend.conductor.state_machine import StageStateMachine, Stage
from backend.agents.storyos_agent import StoryOSAgent

router = APIRouter(prefix="/api/stage5", tags=["stage5"])


class DiagnosisEngine:
    """Zero-LLM deterministic diagnosis across all completed chapters."""

    def __init__(self, project_id: str, projects_dir: Optional[Path] = None):
        self.project_id = project_id
        self.projects_dir = Path(projects_dir) if projects_dir else settings.projects_dir
        self._project_dir = self.projects_dir / project_id
        self._storyos_agent = StoryOSAgent(project_id, self.projects_dir)
        self._fm = FileManager(self.projects_dir)
        self.issues: list[dict] = []
        self._issue_counter = 0

    def _next_id(self) -> str:
        self._issue_counter += 1
        return f"diag_{self._issue_counter:03d}"

    def _add_issue(
        self, priority: str, category: str, chapter: int,
        description: str, suggestion: str, asset_id: str = "",
    ) -> None:
        self.issues.append({
            "id": self._next_id(),
            "priority": priority,
            "category": category,
            "chapter": chapter,
            "description": description,
            "suggestion": suggestion,
            "asset_id": asset_id,
            "status": "open",
        })

    def diagnose(self) -> dict:
        self.issues = []
        self._issue_counter = 0

        progress = self._fm.read_json(self.project_id, "progress.json") or {}
        chapters_progress = progress.get("chapters", [])
        total_chapters = max(
            (ch.get("chapter_number", 0) for ch in chapters_progress),
            default=0,
        )

        # 1. Timeline detection
        self._diagnose_timeline(chapters_progress)

        # 2. Narrative asset legacy detection
        self._diagnose_narrative_assets(total_chapters)

        # 3. Foreshadowing integrity
        self._diagnose_foreshadowing(total_chapters)

        # Summarize
        p0_count = sum(1 for i in self.issues if i["priority"] == "P0")
        p1_count = sum(1 for i in self.issues if i["priority"] == "P1")
        p2_count = sum(1 for i in self.issues if i["priority"] == "P2")

        report = {
            "project_id": self.project_id,
            "total_chapters": total_chapters,
            "issues": self.issues,
            "summary": {"p0_count": p0_count, "p1_count": p1_count, "p2_count": p2_count},
        }

        self._fm.write_json(self.project_id, "diagnosis_report.json", report)
        return report

    def _diagnose_timeline(self, chapters_progress: list[dict]) -> None:
        """Detect unmarked location jumps by processing scenes in order."""
        chapters_dir = self._project_dir / "chapters"

        # Build scene_number → chapter_number mapping
        scene_to_chapter: dict[int, int] = {}
        for ch in chapters_progress:
            ch_num = ch.get("chapter_number", 0)
            for sc in ch.get("scenes", []):
                sc_num = sc.get("scene_number", 0)
                if sc_num:
                    scene_to_chapter[sc_num] = ch_num

        # Process scenes in order, tracking each character's last known location
        # char_last_known: {char: {location, chapter, scene}}
        char_last_known: dict[str, dict] = {}

        if not chapters_dir.exists():
            return

        for draft_file in sorted(chapters_dir.glob("ch*_scene_*_draft.md")):
            match = re.match(r"ch(\d+)_scene_(\d+)_draft\.md", draft_file.name)
            if not match:
                continue
            ch_from_file = int(match.group(1))
            scene_num = int(match.group(2))
            ch_num = ch_from_file or scene_to_chapter.get(scene_num, 0)
            if ch_num == 0:
                continue

            text = draft_file.read_text(encoding="utf-8")
            parsed = self._storyos_agent.parse_sf_logs(text)

            for log in parsed:
                if log.type == "character_location_change":
                    char = log.params.get("char", "")
                    from_loc = log.params.get("from", "")
                    to_loc = log.params.get("to", "")
                    if not char or not to_loc:
                        continue

                    prev = char_last_known.get(char)
                    prev_loc = prev["location"] if prev else None

                    # Detect jump: character had a previous known location,
                    # but the 'from' in the new log doesn't match, AND 'from'
                    # isn't explicitly stated or is "未知"
                    if prev_loc and prev_loc != "未知":
                        from_is_unknown = not from_loc or from_loc == "未知"
                        from_matches_prev = from_loc == prev_loc
                        if from_is_unknown and prev["chapter"] > 0 and prev["chapter"] < ch_num:
                            self._add_issue(
                                priority="P0",
                                category="timeline_break",
                                chapter=ch_num,
                                description=(
                                    f"{char} 在第{prev['chapter']}章末位于「{prev_loc}」，"
                                    f"第{ch_num}章 Scene {scene_num} 出现在「{to_loc}」，"
                                    f"缺少从「{prev_loc}」到「{to_loc}」的位置变更标记"
                                ),
                                suggestion=(
                                    f"添加 <!-- SF_LOG character_location_change "
                                    f'char="{char}" from="{prev_loc}" to="{to_loc}" -->'
                                ),
                            )
                        elif not from_matches_prev and not from_is_unknown:
                            # from doesn't match previous known location
                            self._add_issue(
                                priority="P0",
                                category="timeline_break",
                                chapter=ch_num,
                                description=(
                                    f"{char} 在第{prev['chapter']}章末位于「{prev_loc}」，"
                                    f"第{ch_num}章声称从「{from_loc}」出发到达「{to_loc}」，"
                                    f"位置不一致"
                                ),
                                suggestion=(
                                    f"检查第{prev['chapter']}章和第{ch_num}章之间的位置变化"
                                ),
                            )

                    char_last_known[char] = {
                        "location": to_loc,
                        "chapter": ch_num,
                        "scene": scene_num,
                    }

    def _diagnose_narrative_assets(self, total_chapters: int) -> None:
        """Check all registries for unresolved/legacy assets."""
        storyos_dir = self._project_dir / "storyos"

        # Conflicts: status != "resolved"
        conflicts = self._read_registry(storyos_dir, "conflicts.json")
        for c in conflicts:
            if c.get("status") not in ("resolved",):
                created_ch = c.get("created_chapter", 0)
                self._add_issue(
                    priority="P1",
                    category="unresolved_conflict",
                    chapter=created_ch,
                    description=f"冲突「{c.get('description', c.get('id', ''))}」仍未解决（状态: {c.get('status', 'active')}）",
                    suggestion=f"在后续章节中处理此冲突，或通过 SF_LOG 标记状态变更",
                    asset_id=c.get("id", ""),
                )

        # Mysteries: status != "revealed"
        mysteries = self._read_registry(storyos_dir, "mysteries.json")
        for m in mysteries:
            if m.get("status") not in ("revealed", "resolved"):
                created_ch = m.get("created_chapter", 0)
                clues_count = len(m.get("clues", []))
                chapters_since = total_chapters - created_ch if created_ch else 0
                if chapters_since >= 3:
                    self._add_issue(
                        priority="P1",
                        category="unrevealed_mystery",
                        chapter=created_ch,
                        description=(
                            f"神秘事件「{m.get('question', m.get('id', ''))}」"
                            f"自第{created_ch}章创建后已过{chapters_since}章，"
                            f"仅有 {clues_count} 条线索，尚未揭示"
                        ),
                        suggestion="添加新线索或安排揭示场景",
                        asset_id=m.get("id", ""),
                    )

        # Promises: status = "pending"
        promises = self._read_registry(storyos_dir, "promises.json")
        for p in promises:
            if p.get("status") == "pending":
                created_ch = p.get("created_chapter", 0)
                chapters_since = total_chapters - created_ch if created_ch else 0
                if chapters_since >= 5:
                    self._add_issue(
                        priority="P1",
                        category="pending_promise",
                        chapter=created_ch,
                        description=(
                            f"承诺「{p.get('content', p.get('id', ''))}」"
                            f"自第{created_ch}章后已过{chapters_since}章仍未兑现"
                        ),
                        suggestion="在近期章节中安排承诺兑现，或标记为 broken",
                        asset_id=p.get("id", ""),
                    )

        # Twists: status != "revealed"
        twists = self._read_registry(storyos_dir, "twists.json")
        for t in twists:
            if t.get("status") not in ("revealed",):
                created_ch = t.get("created_chapter", 0)
                planned_ch = t.get("planned_reveal_chapter")
                if planned_ch and total_chapters >= planned_ch:
                    self._add_issue(
                        priority="P1",
                        category="unrevealed_twist",
                        chapter=created_ch,
                        description=(
                            f"转折「{t.get('description', t.get('id', ''))}」"
                            f"计划在第{planned_ch}章揭示，当前已到第{total_chapters}章"
                        ),
                        suggestion="安排转折揭示，或调整计划揭示章节",
                        asset_id=t.get("id", ""),
                    )

        # Goals: status = "active", check progress
        goals = self._read_registry(storyos_dir, "goals.json")
        for g in goals:
            if g.get("status") == "active":
                created_ch = g.get("created_chapter", 0)
                chapters_since = total_chapters - created_ch if created_ch else 0
                progress_val = g.get("progress", "T0")
                if chapters_since >= 5 and progress_val in ("T0", "T1", "T2"):
                    self._add_issue(
                        priority="P2",
                        category="stalled_goal",
                        chapter=created_ch,
                        description=(
                            f"目标「{g.get('content', g.get('id', ''))}」"
                            f"自第{created_ch}章创建后已过{chapters_since}章，"
                            f"进度仍为 {progress_val}"
                        ),
                        suggestion="在后续章节中推进此目标的进展",
                        asset_id=g.get("id", ""),
                    )

        # Reveals: status = "hidden"
        reveals = self._read_registry(storyos_dir, "reveals.json")
        for r in reveals:
            if r.get("status") == "hidden":
                created_ch = r.get("created_chapter", 0)
                chapters_since = total_chapters - created_ch if created_ch else 0
                if chapters_since >= 5:
                    self._add_issue(
                        priority="P1",
                        category="unrevealed_secret",
                        chapter=created_ch,
                        description=(
                            f"秘密「{r.get('content', r.get('id', ''))}」"
                            f"自第{created_ch}章后已过{chapters_since}章仍未揭示"
                        ),
                        suggestion="安排揭示此秘密的场景",
                        asset_id=r.get("id", ""),
                    )

        # Expectations: status = "accumulating" with high intensity
        expectations = self._read_registry(storyos_dir, "expectations.json")
        for e in expectations:
            if e.get("status") == "accumulating":
                intensity = e.get("intensity", 0)
                created_ch = e.get("created_chapter", 0)
                if intensity >= 80:
                    self._add_issue(
                        priority="P2",
                        category="high_expectation",
                        chapter=created_ch,
                        description=(
                            f"期待「{e.get('content', e.get('id', ''))}」"
                            f"强度已达 {intensity}/100，建议尽快满足"
                        ),
                        suggestion="安排满足此期待的场景，避免读者失望",
                        asset_id=e.get("id", ""),
                    )

    def _diagnose_foreshadowing(self, total_chapters: int) -> None:
        """Check foreshadowing integrity."""
        storyos_dir = self._project_dir / "storyos"
        foreshadowings = self._read_registry(storyos_dir, "foreshadowing.json")

        for f in foreshadowings:
            fs_id = f.get("id", "")
            status = f.get("status", "")
            created_ch = f.get("created_chapter", 0)
            chapters_since = total_chapters - created_ch if created_ch else 0

            if status == "dead":
                self._add_issue(
                    priority="P1",
                    category="dead_foreshadowing",
                    chapter=created_ch,
                    description=(
                        f"伏笔「{f.get('description', fs_id)}」已被标记为 dead，"
                        f"可能造成读者困惑"
                    ),
                    suggestion="评估是否需要在后续章节中回收或删除此伏笔",
                    asset_id=fs_id,
                )
            elif status == "planted" and chapters_since >= 5:
                clues_count = len(f.get("clues", []))
                self._add_issue(
                    priority="P1",
                    category="stale_foreshadowing",
                    chapter=created_ch,
                    description=(
                        f"伏笔「{f.get('description', fs_id)}」"
                        f"自第{created_ch}章种下后已过{chapters_since}章，"
                        f"仅有 {clues_count} 条线索，尚未发展"
                    ),
                    suggestion="添加新线索推进伏笔，或安排揭示",
                    asset_id=fs_id,
                )

    def _read_registry(self, storyos_dir: Path, filename: str) -> list[dict]:
        path = storyos_dir / filename
        if not path.exists():
            return []
        with open(path, "r", encoding="utf-8") as f:
            return json.load(f)


# --- API Endpoints ---


def _get_fm():
    return FileManager(settings.projects_dir)


@router.post("/diagnose")
async def run_diagnosis(data: dict):
    project_id = data.get("project_id", "")

    if not project_id:
        raise HTTPException(
            status_code=400,
            detail={"error": True, "code": "VALIDATION_ERROR", "message": "project_id 不能为空", "detail": {}},
        )

    sm = StageStateMachine(settings.projects_dir)
    current = sm.get_current_stage(project_id)
    if current not in (Stage.STAGE5, Stage.STAGE6):
        raise HTTPException(
            status_code=400,
            detail={
                "error": True,
                "code": "STAGE5_NOT_READY",
                "message": f"当前阶段为 {current.value}，无法执行 STAGE5 诊断",
                "detail": {},
            },
        )

    engine = DiagnosisEngine(project_id)
    report = engine.diagnose()

    return {
        "error": False,
        "code": "OK",
        "message": f"诊断完成，发现 {report['summary']['p0_count']} 个 P0、{report['summary']['p1_count']} 个 P1、{report['summary']['p2_count']} 个 P2 问题",
        "detail": report,
    }


@router.get("/diagnosis")
async def get_diagnosis(project_id: str):
    fm = _get_fm()
    if not project_id:
        raise HTTPException(
            status_code=400,
            detail={"error": True, "code": "VALIDATION_ERROR", "message": "project_id 不能为空", "detail": {}},
        )

    report = fm.read_json(project_id, "diagnosis_report.json")
    if report is None:
        raise HTTPException(
            status_code=404,
            detail={"error": True, "code": "DIAGNOSIS_NOT_FOUND", "message": "诊断报告不存在，请先执行诊断", "detail": {}},
        )

    return {
        "error": False,
        "code": "OK",
        "message": "",
        "detail": report,
    }


@router.post("/resolve/{issue_id}")
async def resolve_issue(issue_id: str, data: dict):
    project_id = data.get("project_id", "")
    action = data.get("action", "resolve")  # "resolve" | "skip"
    fm = _get_fm()

    if not project_id:
        raise HTTPException(
            status_code=400,
            detail={"error": True, "code": "VALIDATION_ERROR", "message": "project_id 不能为空", "detail": {}},
        )

    report = fm.read_json(project_id, "diagnosis_report.json")
    if report is None:
        raise HTTPException(
            status_code=404,
            detail={"error": True, "code": "DIAGNOSIS_NOT_FOUND", "message": "诊断报告不存在", "detail": {}},
        )

    issues = report.get("issues", [])
    found = False
    for issue in issues:
        if issue.get("id") == issue_id:
            issue["status"] = "resolved" if action == "resolve" else "accepted"
            found = True
            break

    if not found:
        raise HTTPException(
            status_code=404,
            detail={"error": True, "code": "ISSUE_NOT_FOUND", "message": f"问题 {issue_id} 不存在", "detail": {}},
        )

    fm.write_json(project_id, "diagnosis_report.json", report)

    return {
        "error": False,
        "code": "OK",
        "message": f"问题 {issue_id} 已标记为 {issue['status']}",
        "detail": {"issue_id": issue_id, "status": issue["status"]},
    }
