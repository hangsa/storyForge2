from pathlib import Path
from pydantic_settings import BaseSettings, SettingsConfigDict


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
    genres_dir: Path = Path(__file__).parent.parent / "config" / "genres"
    global_prompt_overrides_path: Path = Path("config/global_prompt_overrides.json")

    # Allow unknown env vars so the migration can write new prefixed keys
    # (e.g. STORYFORGE_PROVIDER_API_KEY_DEEPSEEK) without Settings rejecting
    # the loaded file.
    model_config = SettingsConfigDict(
        env_file="backend/.env",
        env_file_encoding="utf-8",
        extra="ignore",
    )


settings = Settings()
