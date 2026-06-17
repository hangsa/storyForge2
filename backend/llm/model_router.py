"""
StoryForge v1.6 — ModelRouter: 配置驱动的 LLM 模型路由器。

根据 config/model_tiers.yaml 中的 Tier 定义和 Agent 任务映射，
为每个 LLM 调用请求路由到正确的 Provider 和模型。
"""

import json
import logging
from copy import deepcopy
from dataclasses import dataclass, field
from datetime import datetime
from pathlib import Path
from typing import Any, Optional

import yaml

from backend.config import settings
from backend.llm.base_provider import BaseLLMProvider, LLMConfig, LLMResponse

logger = logging.getLogger(__name__)


# --- Data Classes ---


@dataclass
class TierConfig:
    description: str
    models: list[dict]
    default: str
    retry_on_failure: bool = True
    max_retries: int = 1
    fallback: Optional[str] = None


@dataclass
class AgentTaskMapping:
    tier_name: str
    model: Optional[str] = None
    fallback: Optional[str] = None


@dataclass
class RoutingDecision:
    provider_name: str
    model_id: str
    tier_name: str
    max_tokens: int
    cost_per_1k_input: float
    cost_per_1k_output: float


@dataclass
class ModelUnavailableError(Exception):
    provider_name: str
    model_id: str
    tier_name: str

    def __str__(self) -> str:
        return (
            f"Model '{self.model_id}' (provider: {self.provider_name}) "
            f"in tier '{self.tier_name}' is unavailable"
        )


# --- ModelRouter ---


class ModelRouter:
    """配置驱动的 LLM 模型路由器。"""

    # 内置硬编码默认值 — 当 model_tiers.yaml 不存在时使用
    BUILTIN_TIERS: dict[str, dict] = {
        "tier_1": {
            "description": "Scene 写作、STAGE 1-3 内容生成",
            "models": [
                {"id": "deepseek-v4-pro", "provider": "deepseek",
                 "cost_per_1k_input": 0.002, "cost_per_1k_output": 0.008,
                 "max_tokens": 8192},
                {"id": "claude-opus-4", "provider": "anthropic",
                 "cost_per_1k_input": 0.015, "cost_per_1k_output": 0.075,
                 "max_tokens": 8192},
            ],
            "default": "deepseek-v4-pro",
            "retry_on_failure": True,
            "max_retries": 2,
            "fallback": "claude-opus-4",
        },
        "tier_2": {
            "description": "Narrative Guard 状态漂移检测",
            "models": [
                {"id": "claude-sonnet-4", "provider": "anthropic",
                 "cost_per_1k_input": 0.003, "cost_per_1k_output": 0.015,
                 "max_tokens": 4096},
            ],
            "default": "claude-sonnet-4",
            "retry_on_failure": True,
            "max_retries": 1,
            "fallback": None,
        },
        "tier_3": {
            "description": "L1 细节重提取、章摘要生成、风格分类",
            "models": [
                {"id": "claude-haiku", "provider": "anthropic",
                 "cost_per_1k_input": 0.00025, "cost_per_1k_output": 0.00125,
                 "max_tokens": 2048},
            ],
            "default": "claude-haiku",
            "retry_on_failure": True,
            "max_retries": 1,
            "fallback": None,
        },
        "tier_0": {
            "description": "Fact Guard、StoryOS SF_LOG 解析、ReaderOS 计算",
            "models": [],
            "default": "none",
        },
    }

    def __init__(self, config_path: Optional[Path] = None):
        if config_path is None:
            config_path = Path("config/model_tiers.yaml")
        self._config_path = Path(config_path)
        self._tiers: dict[str, TierConfig] = {}
        self._mappings: dict[str, dict[str, AgentTaskMapping]] = {}
        self._provider_status: dict[str, bool] = {}
        self._load_config()

    # --- Config Loading ---

    def _load_config(self) -> None:
        """加载配置文件，不存在时使用内置默认值并自动生成。"""
        if self._config_path.exists():
            with open(self._config_path, "r", encoding="utf-8") as f:
                data = yaml.safe_load(f) or {}
        else:
            logger.warning(
                "model_tiers.yaml not found at %s, using builtin defaults",
                self._config_path,
            )
            data = {"tiers": self.BUILTIN_TIERS, "agent_mapping": {}}
            self._write_config(data)

        self._parse_tiers(data.get("tiers", {}))
        self._parse_mappings(data.get("agent_mapping", {}))

    def _write_config(self, data: dict) -> None:
        """将配置写入 YAML 文件。"""
        self._config_path.parent.mkdir(parents=True, exist_ok=True)
        with open(self._config_path, "w", encoding="utf-8") as f:
            yaml.safe_dump(data, f, allow_unicode=True, default_flow_style=False)

    def _parse_tiers(self, tiers_data: dict) -> None:
        for name, cfg in tiers_data.items():
            self._tiers[name] = TierConfig(
                description=cfg.get("description", ""),
                models=cfg.get("models", []),
                default=cfg.get("default", ""),
                retry_on_failure=cfg.get("retry_on_failure", True),
                max_retries=cfg.get("max_retries", 1),
                fallback=cfg.get("fallback"),
            )

    def _parse_mappings(self, mappings_data: dict) -> None:
        for agent_name, tasks in mappings_data.items():
            self._mappings[agent_name] = {}
            for task_name, task_cfg in tasks.items():
                self._mappings[agent_name][task_name] = AgentTaskMapping(
                    tier_name=task_cfg.get("tier", ""),
                    model=task_cfg.get("model"),
                    fallback=task_cfg.get("fallback"),
                )

    # --- Routing ---

    def resolve(
        self,
        agent_name: str,
        task_name: str,
        force_model: Optional[str] = None,
    ) -> RoutingDecision:
        """
        解析 Agent 任务 → 具体 Provider + 模型。

        解析顺序：
        1. force_model（用户覆盖）→ 查找该 model 所属 tier
        2. agent_mapping[agent][task].model（任务指定模型）
        3. tier.default（Tier 默认模型）
        4. 可用性检查 → 尝试 fallback
        """
        # 1. 查找 Agent → Task 映射
        mapping = self._get_mapping(agent_name, task_name)
        tier = self._get_tier(mapping.tier_name)

        # 2. 确定模型 ID
        model_id = self._pick_model_id(force_model, mapping, tier)

        # 3. 查找模型详情
        model_info = self._find_model_info(tier, model_id)
        if model_info is None:
            raise ModelUnavailableError(
                provider_name="unknown",
                model_id=model_id,
                tier_name=mapping.tier_name,
            )

        return RoutingDecision(
            provider_name=model_info["provider"],
            model_id=model_id,
            tier_name=mapping.tier_name,
            max_tokens=model_info.get("max_tokens", 8192),
            cost_per_1k_input=model_info.get("cost_per_1k_input", 0.0),
            cost_per_1k_output=model_info.get("cost_per_1k_output", 0.0),
        )

    def _get_mapping(self, agent_name: str, task_name: str) -> AgentTaskMapping:
        agent_tasks = self._mappings.get(agent_name)
        if agent_tasks is None:
            raise KeyError(
                f"Agent '{agent_name}' not found in agent_mapping. "
                f"Known agents: {list(self._mappings.keys())}"
            )
        task = agent_tasks.get(task_name)
        if task is None:
            raise KeyError(
                f"Task '{task_name}' not found for agent '{agent_name}'. "
                f"Known tasks: {list(agent_tasks.keys())}"
            )
        return task

    def _get_tier(self, tier_name: str) -> TierConfig:
        if tier_name not in self._tiers:
            raise KeyError(
                f"Tier '{tier_name}' not found. "
                f"Known tiers: {list(self._tiers.keys())}"
            )
        return self._tiers[tier_name]

    def _pick_model_id(
        self,
        force_model: Optional[str],
        mapping: AgentTaskMapping,
        tier: TierConfig,
    ) -> str:
        # User override
        if force_model:
            return force_model

        # Task-specified model
        if mapping.model and mapping.model != "default":
            return mapping.model

        # Tier default
        if tier.default and tier.default != "none":
            return tier.default

        raise ModelUnavailableError(
            provider_name="unknown",
            model_id="none",
            tier_name=tier.description,
        )

    def _find_model_info(
        self, tier: TierConfig, model_id: str
    ) -> Optional[dict]:
        for m in tier.models:
            if m["id"] == model_id:
                return m
        return None

    # --- Execution ---

    async def execute(
        self,
        agent_name: str,
        task_name: str,
        messages: list[dict],
        force_model: Optional[str] = None,
        json_mode: bool = False,
        **kwargs,
    ) -> dict:
        """
        执行一次完整的 LLM 调用（路由 + 调用 + 用量记录）。

        Args:
            agent_name: Agent 名称 (e.g. "writer")
            task_name: 任务名称 (e.g. "scene_writing")
            messages: OpenAI 格式消息列表 [{"role": "system", "content": ...}, ...]
            force_model: 用户强制指定的模型 ID
            json_mode: 是否启用 JSON 模式
            **kwargs: 传递给 provider.generate() 的额外参数

        Returns:
            {"content": str, "usage": {"input": int, "output": int},
             "model": str, "tier": str, "cost": float}
        """
        # 1. Resolve routing
        decision = self.resolve(agent_name, task_name, force_model)

        # 2. Get tier config for retry/failover
        mapping = self._get_mapping(agent_name, task_name)
        tier = self._get_tier(mapping.tier_name)

        # 3. Execute with retry/fallback
        return await self._execute_with_fallback(
            decision=decision,
            mapping=mapping,
            tier=tier,
            agent_name=agent_name,
            task_name=task_name,
            messages=messages,
            json_mode=json_mode,
            **kwargs,
        )

    async def _execute_with_fallback(
        self,
        decision: RoutingDecision,
        mapping: AgentTaskMapping,
        tier: TierConfig,
        agent_name: str,
        task_name: str,
        messages: list[dict],
        json_mode: bool = False,
        **kwargs,
    ) -> dict:
        # Determine fallback chain
        current_model_id = decision.model_id
        fallback_chain = self._build_fallback_chain(mapping, tier, current_model_id)
        max_retries = tier.max_retries if tier.retry_on_failure else 0

        last_error: Optional[Exception] = None

        for attempt_model_id in [current_model_id] + fallback_chain:
            model_info = self._find_model_info(tier, attempt_model_id)
            if model_info is None:
                continue

            for attempt in range(max_retries + 1):
                try:
                    provider = self._create_provider_for_model(model_info)
                    system_prompt, user_prompt = self._extract_prompts(messages)

                    # Remove max_tokens from kwargs to avoid duplicate keyword error
                    # (it is already explicitly set from model config above)
                    generate_kwargs = {k: v for k, v in kwargs.items()
                                       if k != "max_tokens"}
                    response = await provider.generate(
                        system_prompt=system_prompt,
                        user_prompt=user_prompt,
                        json_mode=json_mode,
                        max_tokens=model_info.get("max_tokens", 8192),
                        **generate_kwargs,
                    )

                    cost = self._compute_cost(
                        response.tokens_in,
                        response.tokens_out,
                        model_info.get("cost_per_1k_input", 0),
                        model_info.get("cost_per_1k_output", 0),
                    )

                    self.record_usage(
                        agent_name=agent_name,
                        task_name=task_name,
                        tier_name=decision.tier_name,
                        model_id=attempt_model_id,
                        tokens_in=response.tokens_in,
                        tokens_out=response.tokens_out,
                        cost=cost,
                    )

                    return {
                        "content": response.text,
                        "usage": {"input": response.tokens_in, "output": response.tokens_out},
                        "model": attempt_model_id,
                        "tier": decision.tier_name,
                        "cost": cost,
                    }

                except Exception as e:
                    last_error = e
                    logger.warning(
                        "LLM call failed (agent=%s task=%s model=%s attempt=%d): %s",
                        agent_name, task_name, attempt_model_id, attempt + 1, e,
                    )
                    if attempt >= max_retries:
                        break  # Try next fallback model

        # All fallbacks exhausted
        if decision.tier_name == "tier_2":
            # Narrative Guard: 静默降级
            logger.warning(
                "Narrative Guard unavailable, skipping (agent=%s task=%s)",
                agent_name, task_name,
            )
            return {
                "content": "",
                "usage": {"input": 0, "output": 0},
                "model": "none",
                "tier": decision.tier_name,
                "cost": 0.0,
            }

        if decision.tier_name == "tier_3":
            # Tier 3 辅助任务: 静默降级
            logger.warning(
                "Tier 3 task unavailable, skipping (agent=%s task=%s)",
                agent_name, task_name,
            )
            return {
                "content": "",
                "usage": {"input": 0, "output": 0},
                "model": "none",
                "tier": decision.tier_name,
                "cost": 0.0,
            }

        raise ModelUnavailableError(
            provider_name=decision.provider_name,
            model_id=decision.model_id,
            tier_name=decision.tier_name,
        ) from last_error

    def _build_fallback_chain(
        self,
        mapping: AgentTaskMapping,
        tier: TierConfig,
        current_model_id: str,
    ) -> list[str]:
        """Build ordered fallback chain excluding the current model."""
        chain: list[str] = []
        seen = {current_model_id}

        # 1. agent_mapping fallback
        if mapping.fallback and mapping.fallback not in seen:
            chain.append(mapping.fallback)
            seen.add(mapping.fallback)

        # 2. tier fallback
        if tier.fallback and tier.fallback not in seen:
            chain.append(tier.fallback)
            seen.add(tier.fallback)

        return chain

    def _create_provider_for_model(self, model_info: dict) -> BaseLLMProvider:
        """Create a provider instance for a specific model entry."""
        from backend.llm import AnthropicProvider, DeepSeekProvider, MiniMaxProvider

        provider_name = model_info["provider"]
        model_id = model_info["id"]

        api_keys = {
            "anthropic": settings.anthropic_api_key,
            "deepseek": settings.deepseek_api_key,
            "minimax": settings.minimax_api_key,
        }
        base_urls = {
            "deepseek": settings.deepseek_base_url,
            "minimax": settings.minimax_base_url,
        }
        providers = {
            "anthropic": AnthropicProvider,
            "deepseek": DeepSeekProvider,
            "minimax": MiniMaxProvider,
        }

        api_key = api_keys.get(provider_name, "")
        if not api_key:
            raise ValueError(
                f"API key for provider '{provider_name}' is not configured."
            )

        config = LLMConfig(
            provider=provider_name,
            model=model_id,
            api_key=api_key,
            base_url=base_urls.get(provider_name),
            max_tokens=model_info.get("max_tokens", 8192),
            temperature=settings.llm_temperature,
        )

        provider_class = providers.get(provider_name)
        if provider_class is None:
            raise ValueError(f"Unsupported LLM provider: '{provider_name}'")

        return provider_class(config)

    @staticmethod
    def _extract_prompts(messages: list[dict]) -> tuple[str, str]:
        """Extract system and user prompts from OpenAI-format messages."""
        system_prompt = ""
        user_prompt = ""
        for msg in messages:
            if msg.get("role") == "system":
                system_prompt = msg.get("content", "")
            elif msg.get("role") == "user":
                user_prompt = msg.get("content", "")
        return system_prompt, user_prompt

    @staticmethod
    def _compute_cost(
        tokens_in: int,
        tokens_out: int,
        cost_per_1k_input: float,
        cost_per_1k_output: float,
    ) -> float:
        return (tokens_in / 1000) * cost_per_1k_input + (
            tokens_out / 1000
        ) * cost_per_1k_output

    # --- Usage Recording ---

    def record_usage(
        self,
        agent_name: str,
        task_name: str,
        tier_name: str,
        model_id: str,
        tokens_in: int,
        tokens_out: int,
        cost: float,
    ) -> None:
        """写入 llm_usage.jsonl（项目级别）。"""
        # Usage log is project-specific; for router-level logging, write to a global log.
        log_path = settings.projects_dir.parent / "llm_usage.jsonl" if hasattr(settings, 'projects_dir') else Path("llm_usage.jsonl")
        record = {
            "timestamp": datetime.utcnow().isoformat(),
            "agent": agent_name,
            "task": task_name,
            "tier": tier_name,
            "model": model_id,
            "tokens_in": tokens_in,
            "tokens_out": tokens_out,
            "cost": round(cost, 6),
        }
        try:
            with open(log_path, "a", encoding="utf-8") as f:
                f.write(json.dumps(record, ensure_ascii=False) + "\n")
        except Exception as e:
            logger.warning("Failed to write usage log: %s", e)

    # --- Health Check ---

    def check_provider_health(self, provider_name: str) -> bool:
        """检查 Provider API 连通性（简单可用性标记）。"""
        return self._provider_status.get(provider_name, True)

    # --- Hot Reload ---

    def reload_config(self) -> None:
        """运行时重新加载配置（支持热更新）。"""
        logger.info("Reloading model_tiers.yaml...")
        self._tiers.clear()
        self._mappings.clear()
        self._load_config()
        logger.info(
            "Config reloaded: %d tiers, %d agents",
            len(self._tiers),
            len(self._mappings),
        )


# --- Singleton ---

_router_instance: Optional[ModelRouter] = None


def get_model_router(config_path: Optional[Path] = None) -> ModelRouter:
    """获取全局单例 ModelRouter。"""
    global _router_instance
    if _router_instance is None:
        _router_instance = ModelRouter(config_path)
    return _router_instance


def reset_model_router() -> None:
    """重置 ModelRouter 单例（测试用）。"""
    global _router_instance
    _router_instance = None
