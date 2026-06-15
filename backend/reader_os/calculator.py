from pathlib import Path
from typing import Optional

from backend.config import settings
from backend.utils.file_manager import FileManager
from backend.reader_os.thresholds import GENRE_THRESHOLDS, INTENSITY_SCORES


class ReaderOS:
    """零 LLM — 全部公式计算"""

    def __init__(self, project_id: str, projects_dir: Optional[Path] = None):
        self.project_id = project_id
        self.projects_dir = Path(projects_dir) if projects_dir else settings.projects_dir
        self._project_dir = self.projects_dir / project_id
        self._fm = FileManager(self.projects_dir)

    def _get_thresholds(self, genre: str) -> dict:
        return GENRE_THRESHOLDS.get(genre, GENRE_THRESHOLDS["generic"])

    # --- Addiction (追更欲) ---

    def calculate_addiction(self, chapter_number: int) -> float:
        """
        追更欲 = 好奇心 × 0.30 + 张力 × 0.25 + 满足感 × 0.20 + 结尾钩子 × 0.25
        """
        progress = self._fm.read_json(self.project_id, "progress.json") or {}
        outline = self._fm.read_json(self.project_id, "outline.json") or {}

        curiosity = self._calc_curiosity(progress)
        tension = self._calc_tension(progress)
        satisfaction = self._calc_satisfaction(chapter_number, progress)
        hook = self._calc_cliffhanger(chapter_number, outline)

        return round(
            curiosity * 0.30 + tension * 0.25 + satisfaction * 0.20 + hook * 0.25,
            1,
        )

    def _calc_curiosity(self, progress: dict) -> float:
        """好奇心 = Σ(open_mysteries × weight)，归一化 0-100"""
        narrative_state = self._fm.read_json(self.project_id, "memory/l2/active_narrative_state.json") or {}
        open_mysteries = narrative_state.get("open_mysteries", [])
        open_promises = narrative_state.get("pending_promises", [])
        planted_foreshadowings = narrative_state.get("planted_foreshadowings", [])

        # Simple: count-based scoring with diminishing returns
        total_open = len(open_mysteries) + len(open_promises) + len(planted_foreshadowings)
        if total_open == 0:
            return 30  # baseline
        return min(100, 30 + total_open * 10)

    def _calc_tension(self, progress: dict) -> float:
        """张力 = avg(active_conflicts.intensity)"""
        conflicts = self._fm.read_json(self.project_id, "storyos/conflicts.json")
        if conflicts is None:
            return 30  # baseline

        if isinstance(conflicts, list):
            active = [c for c in conflicts if c.get("status") == "active"]
        else:
            active = [
                c for c in conflicts.get("conflicts", [])
                if c.get("status") == "active"
            ]

        if not active:
            return 20

        scores = [
            INTENSITY_SCORES.get(c.get("intensity", "low"), 20) for c in active
        ]
        return round(sum(scores) / len(scores), 1)

    def _calc_satisfaction(self, chapter_number: int, progress: dict) -> float:
        """满足感 = 基于章完成率和连贯性分数的加权计算"""
        chapters = progress.get("chapters", [])
        recent = [ch for ch in chapters if ch.get("chapter_number", 0) > chapter_number - 3
                  and ch.get("chapter_number", 0) <= chapter_number]

        if not recent:
            return 50  # baseline for first chapter

        total_score = 0.0
        for ch in recent:
            scenes = ch.get("scenes", [])
            if not scenes:
                continue
            completed = sum(1 for s in scenes if s.get("status") in ("completed", "force_passed"))
            completion_rate = completed / len(scenes) if scenes else 0
            avg_coherence = sum(s.get("coherence_score", 0) for s in scenes) / len(scenes)
            total_score += completion_rate * 50 + (avg_coherence / 100) * 50

        return round(min(100, total_score / len(recent)), 1)

    def _calc_cliffhanger(self, chapter_number: int, outline: dict) -> float:
        """结尾钩子 = last_scene.narrative_role 决定"""
        chapters = outline.get("chapters", [])
        chapter = next(
            (ch for ch in chapters if ch.get("chapter_number") == chapter_number),
            None,
        )
        if not chapter:
            return 0

        scenes = chapter.get("scene_plan", [])
        if not scenes:
            return 0

        last_scene = scenes[-1]
        role = last_scene.get("narrative_role", "")
        if role == "cliffhanger":
            return 100
        elif role == "mini_payoff":
            return 50
        return 0

    # --- Fatigue (疲劳度) ---

    def calculate_fatigue(self, chapter_number: int, genre: str = "cool_novel") -> float:
        """
        爽文体裁: fatigue = max(0, avg_tension_3_chapters - 60) × 1.0
        通用体裁: fatigue = max(0, avg_tension_3_chapters - 50) × 1.5
        """
        thresholds = self._get_thresholds(genre)
        formula = thresholds["fatigue_formula"]

        progress = self._fm.read_json(self.project_id, "progress.json") or {}
        chapters = progress.get("chapters", [])

        # Get last 3 chapters' tension
        recent = [ch for ch in chapters if ch.get("chapter_number", 0) <= chapter_number
                   and ch.get("chapter_number", 0) > chapter_number - 3]

        if not recent:
            return 0

        tensions = []
        for ch in recent:
            reader_os = ch.get("reader_os", {}) or {}
            t = reader_os.get("avg_tension", 30)
            if isinstance(t, (int, float)):
                tensions.append(t)

        if not tensions:
            return 0

        avg_tension = sum(tensions) / len(tensions)
        raw = max(0, avg_tension - formula["threshold"]) * formula["decay"]
        return round(raw, 1)

    # --- Curiosity (好奇心) ---

    def calculate_curiosity(self, chapter_number: int) -> float:
        """好奇心: Σ(open_mysteries×weight), normalized 0-100."""
        progress = self._fm.read_json(self.project_id, "progress.json") or {}
        return self._calc_curiosity(progress)

    # --- Tension (张力) ---

    def calculate_tension(self, chapter_number: int) -> float:
        """张力: avg(active_conflicts.intensity), 0-100."""
        progress = self._fm.read_json(self.project_id, "progress.json") or {}
        return self._calc_tension(progress)

    # --- Satisfaction (满足感) ---

    def calculate_satisfaction(self, chapter_number: int) -> float:
        """满足感: based on chapter completion rate and coherence scores."""
        progress = self._fm.read_json(self.project_id, "progress.json") or {}
        return self._calc_satisfaction(chapter_number, progress)

    # --- Frustration (挫败感) ---

    def calculate_frustration(self, chapter_number: int, genre: str = "cool_novel") -> float:
        """
        挫败感: inverse of satisfaction, boosted by retry failures.
        Formula: max(0, min(100, (100 - satisfaction)*0.7 + retry_penalty*0.3))
        """
        progress = self._fm.read_json(self.project_id, "progress.json") or {}
        satisfaction = self._calc_satisfaction(chapter_number, progress)

        chapters = progress.get("chapters", [])
        relevant = [ch for ch in chapters if ch.get("chapter_number", 0) <= chapter_number]
        total_retries = sum(
            s.get("retry_count", 0)
            for ch in relevant
            for s in ch.get("scenes", [])
        )
        total_scenes = sum(len(ch.get("scenes", [])) for ch in relevant)
        retry_penalty = min(100, (total_retries / max(1, total_scenes)) * 100)

        raw = max(0, min(100, (100 - satisfaction) * 0.7 + retry_penalty * 0.3))
        thresholds = self._get_thresholds(genre)
        formula = thresholds.get("fatigue_formula", {})
        decay = formula.get("decay", 1.0)
        return round(raw * decay, 1)

    # --- Discussion (讨论潜力) ---

    def calculate_discussion(self, chapter_number: int) -> float:
        """
        讨论潜力: based on open mysteries, twists, and cliffhangers.
        Formula: min(100, (open_mysteries*10 + planted_ff*8 + revealed_twists*15 + cliffhanger*30) * 0.8)
        """
        progress = self._fm.read_json(self.project_id, "progress.json") or {}
        narrative_state = self._fm.read_json(self.project_id, "memory/l2/active_narrative_state.json") or {}

        open_mysteries = len(narrative_state.get("open_mysteries", []))
        planted_foreshadowings = len(narrative_state.get("planted_foreshadowings", []))

        twists = self._fm.read_json(self.project_id, "storyos/twists.json") or []
        if isinstance(twists, dict):
            twists = twists.get("twists", [])
        revealed_twists = sum(1 for t in twists if t.get("status") in ("revealed", "partially_revealed"))

        outline = self._fm.read_json(self.project_id, "outline.json") or {}
        chapters = outline.get("chapters", [])
        chapter = next((ch for ch in chapters if ch.get("chapter_number") == chapter_number), None)
        has_cliffhanger = 0
        if chapter:
            scenes = chapter.get("scene_plan", [])
            if scenes and scenes[-1].get("narrative_role") == "cliffhanger":
                has_cliffhanger = 1

        raw = (open_mysteries * 10 + planted_foreshadowings * 8 + revealed_twists * 15 + has_cliffhanger * 30) * 0.8
        return round(min(100, raw), 1)

    # --- Warnings ---

    def get_warnings(self, chapter_number: int, genre: str = "cool_novel") -> list[dict]:
        thresholds = self._get_thresholds(genre)
        addiction = self.calculate_addiction(chapter_number)
        fatigue = self.calculate_fatigue(chapter_number, genre)

        warnings = []

        if addiction < thresholds["addiction_critical"]:
            warnings.append({
                "level": "critical",
                "metric": "addiction",
                "value": addiction,
                "hint": "追更欲严重偏低，急需增加反转或重大悬念",
            })
        elif addiction < thresholds["addiction_severe"]:
            warnings.append({
                "level": "severe",
                "metric": "addiction",
                "value": addiction,
                "hint": "当前追更欲偏低，考虑增加反转或悬念",
            })

        if fatigue > thresholds["fatigue_moderate"]:
            warnings.append({
                "level": "moderate",
                "metric": "fatigue",
                "value": fatigue,
                "hint": "读者疲劳度上升，考虑安排过渡章或降低冲突密度",
            })

        return warnings

    def get_trend(self, metric: str, window: int = 5) -> list[float]:
        progress = self._fm.read_json(self.project_id, "progress.json") or {}
        chapters = progress.get("chapters", [])
        values = []
        for ch in chapters[-window:]:
            reader_os = ch.get("reader_os", {}) or {}
            val = reader_os.get(metric, 0)
            if isinstance(val, (int, float)):
                values.append(float(val))
        return values

    def snapshot(self, chapter_number: int, genre: str = "cool_novel") -> dict:
        """Return a complete ReaderOS snapshot with all 7 v1.6 metrics."""
        return {
            "addiction": self.calculate_addiction(chapter_number),
            "fatigue": self.calculate_fatigue(chapter_number, genre),
            "curiosity": self.calculate_curiosity(chapter_number),
            "tension": self.calculate_tension(chapter_number),
            "satisfaction": self.calculate_satisfaction(chapter_number),
            "frustration": self.calculate_frustration(chapter_number, genre),
            "discussion": self.calculate_discussion(chapter_number),
            "warnings": self.get_warnings(chapter_number, genre),
        }
