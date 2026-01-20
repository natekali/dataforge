"""Application configuration."""

from pathlib import Path

from pydantic_settings import BaseSettings, SettingsConfigDict


class Settings(BaseSettings):
    """Application settings loaded from environment."""

    model_config = SettingsConfigDict(
        env_file=".env",
        env_file_encoding="utf-8",
        extra="ignore",
    )

    # Application
    version: str = "0.1.0"
    debug: bool = True
    host: str = "0.0.0.0"
    port: int = 8000

    # CORS
    cors_origins: list[str] = ["http://localhost:3000", "http://127.0.0.1:3000"]

    # Database
    database_url: str = "sqlite+aiosqlite:///./dataforge.db"
    duckdb_path: str = "./dataforge_analytics.duckdb"

    # Storage
    upload_dir: Path = Path("./uploads")
    max_upload_size: int = 500 * 1024 * 1024  # 500MB

    # AI Providers
    openai_api_key: str | None = None
    anthropic_api_key: str | None = None
    ollama_base_url: str = "http://localhost:11434"

    # Processing
    default_batch_size: int = 100
    max_concurrent_jobs: int = 4

    # Logging
    log_level: str = "INFO"
    log_format: str = "json"  # json or console
    log_file: str | None = None

    # Rate Limiting
    rate_limit_enabled: bool = True
    rate_limit_per_minute: int = 60
    rate_limit_per_hour: int = 1000

    def __init__(self, **kwargs):
        super().__init__(**kwargs)
        # Ensure upload directory exists
        self.upload_dir.mkdir(parents=True, exist_ok=True)


settings = Settings()
