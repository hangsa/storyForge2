import json
import logging
import yaml
from pathlib import Path
from datetime import datetime
from typing import Any, Optional

from backend.config import settings
from backend.llm import create_provider, BaseLLMProvider, LLMResponse
from backend.llm.model_router import (
    ModelRouter,
    ModelUnavailableError,
    get_model_router,
)
from backend.utils.json_parser import parse_json_strict, parse_json_text

logger = logging.getLogger(__name__)


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
    # v1.6: Agent name for ModelRouter task mapping.
    # Subclasses override this to match agent_mapping keys in model_tiers.yaml.
    agent_name: str = ""

    def __init__(
        self,
        project_id: str,
        prompts_dir: Optional[Path] = None,
        model_router: Optional[ModelRouter] = None,
    ):
        self.project_id = project_id
        self.prompts_dir = Path(prompts_dir) if prompts_dir else settings.prompts_dir
        self._provider: Optional[BaseLLMProvider] = None
        self._usage_log_path: Optional[Path] = None
        self._router = model_router

    @property
    def provider(self) -> BaseLLMProvider:
        if self._provider is None:
            self._provider = create_provider()
        return self._provider

    @property
    def router(self) -> ModelRouter:
        if self._router is None:
            self._router = get_model_router()
        return self._router

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

        # v1.6: Route through ModelRouter when agent_name is configured
        if self.agent_name:
            return await self.generate_with_tier(
                task_name=template_name,
                system_prompt=system,
                user_prompt=user,
                json_mode=prompt.is_json_mode,
                max_retries=max_retries,
                max_tokens=prompt.max_tokens,
                temperature=prompt.temperature,
            )

        return await self.generate(
            system_prompt=system,
            user_prompt=user,
            json_mode=prompt.is_json_mode,
            max_retries=max_retries,
            max_tokens=prompt.max_tokens,
            temperature=prompt.temperature,
        )

    # --- v1.6: Tier-based LLM routing ---

    async def generate_with_tier(
        self,
        task_name: str,
        system_prompt: str,
        user_prompt: str,
        json_mode: bool = False,
        max_retries: int = 2,
        force_model: Optional[str] = None,
        **kwargs,
    ) -> tuple[dict, "LLMResponse"]:
        """
        v1.6: 通过 ModelRouter 路由的 LLM 调用。

        替代直接调用 self.provider.generate()，支持：
        - 按 Agent/Task 自动选择 Tier 和模型
        - Tier 2/3 不可用时静默降级
        - Tier 0 任务会抛出 ModelUnavailableError（不应调用此方法）
        - 自动记录用量（agent/tier/model 三维度）

        Args:
            task_name: 任务名（对应 agent_mapping 中的 key）
            system_prompt: 系统 prompt
            user_prompt: 用户 prompt
            json_mode: 是否尝试解析 JSON 输出
            max_retries: JSON 解析失败时的最大重试次数
            force_model: 用户强制指定的模型 ID（可选）

        Returns:
            (parsed_dict, LLMResponse)
        """
        if not self.agent_name:
            raise RuntimeError(
                f"{self.__class__.__name__}.agent_name is not set. "
                "Set agent_name to use generate_with_tier()."
            )

        messages = [
            {"role": "system", "content": system_prompt},
            {"role": "user", "content": user_prompt},
        ]

        last_text: Optional[str] = None
        last_error: Optional[str] = None

        for attempt in range(max_retries + 1):
            try:
                result = await self.router.execute(
                    agent_name=self.agent_name,
                    task_name=task_name,
                    messages=messages,
                    force_model=force_model,
                    json_mode=json_mode,
                    **kwargs,
                )
            except ModelUnavailableError:
                # Tier 0 or truly unavailable - re-raise for caller to handle
                raise

            content = result.get("content", "")
            if not content:
                # Tier 2/3 silent degradation — empty content
                return {"text": "", "degraded": True}, LLMResponse(
                    text="", tokens_in=0, tokens_out=0,
                    model=result.get("model", "none"),
                    provider="none",
                )

            if not json_mode:
                return {"text": content}, LLMResponse(
                    text=content,
                    tokens_in=result["usage"]["input"],
                    tokens_out=result["usage"]["output"],
                    model=result["model"],
                    provider=self.router._find_model_info(
                        self.router._get_tier(result["tier"]),
                        result["model"],
                    )["provider"] if result["model"] != "none" else "none",
                )

            # JSON mode: parse and retry
            parsed = self._parse_json(content)
            if parsed is not None:
                return parsed, LLMResponse(
                    text=content,
                    tokens_in=result["usage"]["input"],
                    tokens_out=result["usage"]["output"],
                    model=result["model"],
                    provider=result["model"],
                )

            last_text = content
            last_error = f"JSON parse failed (attempt {attempt + 1})"
            user_prompt = self._build_retry_prompt(user_prompt, content)
            messages[1]["content"] = user_prompt

        # Final loose extraction
        if last_text and json_mode:
            extracted = self._extract_json_loose(last_text)
            if extracted is not None:
                return extracted, LLMResponse(
                    text=last_text, tokens_in=0, tokens_out=0,
                    model="unknown", provider="unknown",
                )

        raise ValueError(
            f"Failed to parse JSON after {max_retries + 1} attempts. "
            f"Last error: {last_error}"
        )

    def log_usage(
        self,
        template_name: str,
        response: LLMResponse,
        extra: Optional[dict] = None,
        tier: Optional[str] = None,
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
        if tier:
            record["tier"] = tier
        log_path = self._ensure_usage_log()
        with open(log_path, "a", encoding="utf-8") as f:
            f.write(json.dumps(record, ensure_ascii=False) + "\n")

    def _parse_json(self, text: str) -> Optional[dict]:
        return parse_json_strict(text)

    def _extract_json_loose(self, text: str) -> Optional[dict]:
        return parse_json_text(text)

    def _build_retry_prompt(self, original: str, failed_response: str) -> str:
        return (
            f"{original}\n\n"
            f"你的上一次回复无法解析为JSON。请确保回复是严格的JSON对象。\n"
            f"上一次回复的开头: {failed_response[:200]}"
        )
