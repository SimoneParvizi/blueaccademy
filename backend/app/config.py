from functools import lru_cache
from pydantic_settings import BaseSettings


class Settings(BaseSettings):
    app_name: str = "blueaccademy API"
    app_env: str = "development"
    # TODO: CORS in prd?
    cors_origins: list[str] = [
        "http://localhost:5173",
        "http://127.0.0.1:5173",
    ]
    database_url: str
    enable_more: bool = False


@lru_cache
def get_settings() -> Settings:
    return Settings()