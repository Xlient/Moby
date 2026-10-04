"""Model clients for Nebius Token Factory (OpenAI-compatible endpoint).

One place decides which model each graph node uses (plan v3 §4), so a model
swap is a config change, not a code hunt.
"""
from typing import Literal

from langchain_openai import ChatOpenAI, OpenAIEmbeddings

from moby.config import get_settings

Tier = Literal["nano", "super", "ultra"]

# Embedding model and the dimension the schema is locked to (db/migrations/0003).
# Qwen3-Embedding-8B is natively 4096-d and supports shorter Matryoshka outputs;
# 1024 stays under pgvector's 2000-dim HNSW limit with little quality loss.
EMBEDDING_MODEL = "Qwen/Qwen3-Embedding-8B"
EMBEDDING_DIM = 1024


def model_name(tier: Tier) -> str:
    s = get_settings()
    return {"nano": s.model_nano, "super": s.model_super, "ultra": s.model_ultra}[tier]


def _api_key():
    key = get_settings().token_factory_api_key
    if key is None:
        raise RuntimeError("N_FACTORY_ACC_KEY is not set (Token Factory API key); add it to .env")
    return key


def chat_model(tier: Tier, **kwargs) -> ChatOpenAI:
    """ChatOpenAI pointed at Token Factory. kwargs pass through (temperature, max_tokens, ...)."""
    s = get_settings()
    return ChatOpenAI(
        model=model_name(tier),
        base_url=s.token_factory_base_url,
        api_key=_api_key(),
        **kwargs,
    )


def embeddings() -> OpenAIEmbeddings:
    s = get_settings()
    return OpenAIEmbeddings(
        model=EMBEDDING_MODEL,
        dimensions=EMBEDDING_DIM,
        base_url=s.token_factory_base_url,
        api_key=_api_key(),
        # Token Factory takes raw strings; skip tiktoken pre-tokenisation (OpenAI-only).
        check_embedding_ctx_length=False,
    )
