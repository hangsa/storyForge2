from pathlib import Path
from typing import Optional

from backend.config import settings


class GenreTemplate:
    """Reads and provides genre template settings from YAML files."""

    def __init__(self, style_dir: Optional[Path] = None):
        self.style_dir = Path(style_dir) if style_dir else settings.style_dir

    def load(self, template_name: str = "cool_novel") -> dict:
        path = self.style_dir / f"{template_name}.yaml"
        if not path.exists():
            raise FileNotFoundError(f"Style template not found: {path}")

        import yaml
        with open(path, "r", encoding="utf-8") as f:
            data = yaml.safe_load(f)

        return data or {}

    def get_pacing(self, template_name: str = "cool_novel") -> dict:
        template = self.load(template_name)
        return template.get("pacing", {})

    def get_tone_rules(self, template_name: str = "cool_novel") -> dict:
        template = self.load(template_name)
        return {
            "tone": template.get("tone", ""),
            "taboo_words": template.get("taboo_words", []),
            "style_rules": template.get("style_rules", []),
        }

    def get_taboos(self, template_name: str = "cool_novel") -> list[str]:
        template = self.load(template_name)
        return template.get("taboo_words", [])

    def get_style_formula(self, template_name: str = "cool_novel") -> dict:
        """Read style_formula section from genre template. Returns {} if not configured."""
        template = self.load(template_name)
        return template.get("style_formula", {})
