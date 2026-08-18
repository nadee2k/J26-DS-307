from pydantic_settings import BaseSettings
from functools import lru_cache


class Settings(BaseSettings):
    DATABASE_URL: str = "postgresql+asyncpg://postgres:postgres123@localhost:5432/student_data_collection"
    DATABASE_URL_SYNC: str = "postgresql+psycopg2://postgres:postgres123@localhost:5432/student_data_collection"
    SECRET_KEY: str = "change-me-in-production"
    ENVIRONMENT: str = "development"

    class Config:
        env_file = ".env"


@lru_cache()
def get_settings() -> Settings:
    return Settings()
