import json
import shutil
import yaml
from pathlib import Path
from typing import Any, Optional, Union


class FileManager:
    def __init__(self, projects_dir: Path):
        self.projects_dir = Path(projects_dir)

    def ensure_project_dir(self, project_id: str) -> Path:
        project_dir = self.projects_dir / project_id
        project_dir.mkdir(parents=True, exist_ok=True)
        (project_dir / "storyos").mkdir(exist_ok=True)
        (project_dir / "chapters").mkdir(exist_ok=True)
        return project_dir

    def project_path(self, project_id: str, filename: str) -> Path:
        return self.projects_dir / project_id / filename

    def read_json(self, project_id: str, filename: str) -> Optional[dict]:
        path = self.project_path(project_id, filename)
        if not path.exists():
            return None
        with open(path, "r", encoding="utf-8") as f:
            return json.load(f)

    def write_json(self, project_id: str, filename: str, data: Any) -> None:
        self.ensure_project_dir(project_id)
        path = self.project_path(project_id, filename)
        tmp_path = path.with_suffix(".tmp")
        with open(tmp_path, "w", encoding="utf-8") as f:
            json.dump(data, f, ensure_ascii=False, indent=2)
        tmp_path.replace(path)

    def read_yaml(self, filepath: Path) -> Optional[dict]:
        if not filepath.exists():
            return None
        with open(filepath, "r", encoding="utf-8") as f:
            return yaml.safe_load(f)

    def append_jsonl(self, project_id: str, filename: str, record: dict) -> None:
        path = self.project_path(project_id, filename)
        with open(path, "a", encoding="utf-8") as f:
            f.write(json.dumps(record, ensure_ascii=False) + "\n")

    def write_markdown(self, project_id: str, filename: str, content: str) -> None:
        path = self.project_path(project_id, filename)
        with open(path, "w", encoding="utf-8") as f:
            f.write(content)

    def project_exists(self, project_id: str) -> bool:
        return self.project_path(project_id, "project.json").exists()

    def delete_project(self, project_id: str) -> bool:
        project_dir = self.projects_dir / project_id
        if not project_dir.exists():
            return False
        shutil.rmtree(project_dir)
        return True
