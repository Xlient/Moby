"""Backend settings, read from the environment (and .env in development).

Secrets (the Token Factory key, DATABASE_URL credentials, LangSmith key) only ever
come from the environment; nothing here has a real default for them.
"""
from functools import lru_cache

from pydantic import Field, SecretStr
from pydantic_settings import BaseSettings, SettingsConfigDict


class Settings(BaseSettings):
    model_config = SettingsConfigDict(env_file=".env", extra="ignore")

    # ── Nebius Token Factory (OpenAI-compatible) ─────────────────────────
    # Optional so services that never call a model (the feed poller) start without it;
    # moby.llm raises a clear error if it is missing when a model is actually used.
    token_factory_api_key: SecretStr | None = Field(default=None, validation_alias="N_FACTORY_ACC_KEY")
    token_factory_base_url: str = "https://api.tokenfactory.nebius.com/v1/"

    # Exact model strings, verified by scripts/verify_models.py (see docs/models.md).
    model_nano: str = "nvidia/NVIDIA-Nemotron-3-Nano-30B-A3B"
    model_super: str = "nvidia/nemotron-3-super-120b-a12b"
    model_ultra: str = "nvidia/Nemotron-3-Ultra-550b-a55b"

    # ── Storage ──────────────────────────────────────────────────────────
    database_url: str = "postgresql://moby:moby@localhost:5432/moby"

    # ── Auth (Firebase ID tokens from the app) ───────────────────────────
    firebase_project_id: str = ""
    # Public Firebase web config for the reviewer console's sign-in (not secrets).
    firebase_web_api_key: str = ""
    firebase_auth_domain: str = ""
    # Secret salt for reporter_hash (HMAC of the Firebase uid). Stable per deployment:
    # changing it makes old and new reports from one person look like different people.
    moby_reporter_salt: SecretStr = SecretStr("dev-only-reporter-salt")
    # Local development and tests only: accept requests without a Firebase token.
    moby_auth_disabled: bool = False

    # ── Official feeds ───────────────────────────────────────────────────
    # api.weather.gov rejects requests without an identifying User-Agent.
    nws_user_agent: str = "moby-early-warning/0.1 (github.com/Xlient/Moby)"


@lru_cache
def get_settings() -> Settings:
    return Settings()
