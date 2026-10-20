"""Model clients for Nebius Token Factory (OpenAI-compatible endpoint).

One place decides which model each graph node uses (plan v3 §4), so a model
swap is a config change, not a code hunt.
"""
from functools import lru_cache
from typing import Literal

import httpx
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


# LangChain asks the OpenAI SDK for raw responses, and the SDK announces that with this header.
# It only matters to the client, but since 2026-10-20 Token Factory answers 500 ("Unable to
# process request") to any Super or Ultra request that carries it (Nano doesn't mind). Every
# Super/Ultra feature failed with it: Ask Moby, explanations, briefs, trip briefings.
_DROPPED_HEADERS = ("x-stainless-raw-response",)


def _drop_headers(request: httpx.Request) -> None:
    """Before sending: take the headers off, remembering them on the request."""
    dropped = {name: request.headers.pop(name) for name in _DROPPED_HEADERS if name in request.headers}
    request.extensions["moby_dropped_headers"] = dropped


def _restore_headers(response: httpx.Response) -> None:
    """After the response: put them back. The SDK reads them off the request to decide how
    to hand the response to LangChain; they've already been kept off the wire."""
    response.request.headers.update(response.request.extensions.pop("moby_dropped_headers", {}))


async def _adrop_headers(request: httpx.Request) -> None:
    _drop_headers(request)


async def _arestore_headers(response: httpx.Response) -> None:
    _restore_headers(response)


HOOKS = {"request": [_drop_headers], "response": [_restore_headers]}
ASYNC_HOOKS = {"request": [_adrop_headers], "response": [_arestore_headers]}


@lru_cache(maxsize=1)
def _http_clients() -> tuple[httpx.Client, httpx.AsyncClient]:
    """Shared clients (one connection pool for every model) that send requests without
    _DROPPED_HEADERS. Timeouts match the OpenAI SDK's default."""
    timeout = httpx.Timeout(600.0, connect=5.0)
    return (httpx.Client(timeout=timeout, event_hooks=HOOKS),
            httpx.AsyncClient(timeout=timeout, event_hooks=ASYNC_HOOKS))


def chat_model(tier: Tier, **kwargs) -> ChatOpenAI:
    """ChatOpenAI pointed at Token Factory. kwargs pass through (temperature, max_tokens, ...)."""
    s = get_settings()
    sync_client, async_client = _http_clients()
    return ChatOpenAI(
        model=model_name(tier),
        base_url=s.token_factory_base_url,
        api_key=_api_key(),
        http_client=sync_client,
        http_async_client=async_client,
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
