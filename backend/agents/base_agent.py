import json
import re
import yaml
from pathlib import Path
from datetime import datetime
from typing import Any, Optional

from backend.config import settings
from backend.llm import create_provider, BaseLLMProvider, LLMResponse


class PromptTemplate:
    def __init__(self, data: dict):
        self.name: str = data.get("name", "")
        self.provider: str = data.get("provider", settings.llm_provider)
        self.model: str = data.get("model", settings.llm_model)
        self.temperature: float = data.get("temperature", settings.llm_temperature)
        self.max_tokens: int = data.get("max_tokens", settings.llm_max_tokens)
        self.system_prompt: str = data.get("system_prompt", "")
        self.user_prompt_template: str = data.get("user_prompt_template", "")
        self.output_format: dict = data.get("output_format", {})

    def format_system(self, **kwargs) -> str:
        return self.system_prompt.format(**kwargs)

    def format_user(self, **kwargs) -> str:
        return self.user_prompt_template.format(**kwargs)

    @property
    def is_json_mode(self) -> bool:
        return self.output_format.get("type") == "json"


class BaseAgent:
    def __init__(self, project_id: str, prompts_dir: Optional[Path] = None):
        self.project_id = project_id
        self.prompts_dir = Path(prompts_dir) if prompts_dir else settings.prompts_dir
        self._provider: Optional[BaseLLMProvider] = None
        self._usage_log_path: Optional[Path] = None

    @property
    def provider(self) -> BaseLLMProvider:
        if self._provider is None:
            self._provider = create_provider()
        return self._provider

    def _ensure_usage_log(self) -> Path:
        if self._usage_log_path is None:
            project_dir = settings.projects_dir / self.project_id
            project_dir.mkdir(parents=True, exist_ok=True)
            self._usage_log_path = project_dir / "llm_usage.jsonl"
        return self._usage_log_path

    def load_prompt(self, template_name: str) -> PromptTemplate:
        path = self.prompts_dir / f"{template_name}.yaml"
        if not path.exists():
            raise FileNotFoundError(f"Prompt template not found: {path}")
        with open(path, "r", encoding="utf-8") as f:
            data = yaml.safe_load(f)
        if data is None:
            raise ValueError(f"Empty prompt template: {path}")
        return PromptTemplate(data)

    async def generate(
        self,
        system_prompt: str,
        user_prompt: str,
        json_mode: bool = False,
        max_retries: int = 2,
        **kwargs,
    ) -> tuple[dict, LLMResponse]:
        last_response: Optional[LLMResponse] = None
        last_error: Optional[str] = None

        for attempt in range(max_retries + 1):
            response = await self.provider.generate(
                system_prompt=system_prompt,
                user_prompt=user_prompt,
                json_mode=json_mode,
                **kwargs,
            )

            if not json_mode:
                return {"text": response.text}, response

            parsed = self._parse_json(response.text)
            if parsed is not None:
                return parsed, response

            last_response = response
            last_error = f"JSON parse failed (attempt {attempt + 1})"
            user_prompt = self._build_retry_prompt(user_prompt, response.text)

        if last_response and json_mode:
            extracted = self._extract_json_loose(last_response.text)
            if extracted is not None:
                return extracted, last_response

        raise ValueError(
            f"Failed to parse JSON after {max_retries + 1} attempts. "
            f"Last error: {last_error}"
        )

    async def generate_from_template(
        self,
        template_name: str,
        max_retries: int = 2,
        **kwargs,
    ) -> tuple[dict, LLMResponse]:
        prompt = self.load_prompt(template_name)

        system = prompt.format_system(**kwargs)
        user = prompt.format_user(**kwargs)

        return await self.generate(
            system_prompt=system,
            user_prompt=user,
            json_mode=prompt.is_json_mode,
            max_retries=max_retries,
            max_tokens=prompt.max_tokens,
            temperature=prompt.temperature,
        )

    def log_usage(
        self,
        template_name: str,
        response: LLMResponse,
        extra: Optional[dict] = None,
    ) -> None:
        record = {
            "timestamp": datetime.utcnow().isoformat(),
            "project_id": self.project_id,
            "template": template_name,
            "provider": response.provider,
            "model": response.model,
            "tokens_in": response.tokens_in,
            "tokens_out": response.tokens_out,
            "finish_reason": response.finish_reason,
            "extra": extra or {},
        }
        log_path = self._ensure_usage_log()
        with open(log_path, "a", encoding="utf-8") as f:
            f.write(json.dumps(record, ensure_ascii=False) + "\n")

    def _parse_json(self, text: str) -> Optional[dict]:
        text = text.strip()
        if not text:
            return None

        # Direct parse
        try:
            return json.loads(text)
        except json.JSONDecodeError:
            pass

        # Extract from markdown code block
        match = re.search(r"```(?:json)?\s*([\s\S]*?)\s*```", text)
        if match:
            try:
                return json.loads(match.group(1))
            except json.JSONDecodeError:
                pass

        return None

    def _extract_json_loose(self, text: str) -> Optional[dict]:
        """Last-resort extraction: find outermost { } pair."""
        start = text.find("{")
        end = text.rfind("}")
        if start == -1 or end == -1 or start >= end:
            return None
        try:
            return json.loads(text[start : end + 1])
        except json.JSONDecodeError:
            return None

    def _build_retry_prompt(self, original: str, failed_response: str) -> str:
        return (
            f"{original}\n\n"
            f"你的上一次回复无法解析为JSON。请确保回复是严格的JSON对象。\n"
            f"上一次回复的开头: {failed_response[:200]}"
        )
