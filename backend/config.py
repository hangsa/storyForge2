from pathlib import Path
from pydantic_settings import BaseSettings


class Settings(BaseSettings):
    llm_provider: str = "deepseek"
    llm_model: str = "deepseek-chat"

    anthropic_api_key: str = ""
    deepseek_api_key: str = ""
    deepseek_base_url: str = "https://api.deepseek.com/v1"
    minimax_api_key: str = ""
    minimax_base_url: str = "https://api.minimax.chat/v1"

    llm_max_tokens: int = 8192
    llm_temperature: float = 0.7

    projects_dir: Path = Path("projects")
    prompts_dir: Path = Path("backend/prompts")
    style_dir: Path = Path("data/style")

    model_config = {"env_file": ".env", "env_file_encoding": "utf-8"}


settings = Settings()
