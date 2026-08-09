import os
from functools import lru_cache

from pydantic import Field
from pydantic_settings import BaseSettings, SettingsConfigDict


class Settings(BaseSettings):  # TODO: what is the advantage of having base settings?
    app_name: str = "blueaccademy API"
    app_env: str = "development"
    # TODO: can you have less CORS?
    # TODO: what about in prd? do we need so many urls?
    cors_origins: list[str] = [
        "http://localhost:5173",
        "http://127.0.0.1:5173",
        "http://localhost:5005",
        "http://127.0.0.1:5005",
    ]
    database_url: str = Field(os.environ["DATABASE_URL"])
    model_config = SettingsConfigDict(  # TODO: is this necessary ?
        env_file=".env",
        env_file_encoding="utf-8",
        extra="ignore",
    )
    enable_more: bool = False


@lru_cache  # TODO: what is lru_cache?
def get_settings() -> Settings:
    return Settings()  # TODO: is this causing issues?
