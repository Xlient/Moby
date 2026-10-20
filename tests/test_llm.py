"""moby/llm.py: requests to Token Factory never carry the header it rejects (no network)."""
import asyncio

import httpx

from moby import llm


def test_raw_response_header_is_dropped_before_sending():
    req = httpx.Request("POST", "https://example.test/v1/chat/completions",
                        headers={"X-Stainless-Raw-Response": "true", "Authorization": "Bearer k"})
    llm._drop_headers(req)
    assert "x-stainless-raw-response" not in req.headers and req.headers["authorization"] == "Bearer k"
    llm._restore_headers(httpx.Response(200, request=req))      # back for the SDK, after sending
    assert req.headers["x-stainless-raw-response"] == "true"


def test_chat_models_send_through_the_filtering_clients(monkeypatch):
    seen = []

    def handler(request: httpx.Request) -> httpx.Response:
        seen.append(dict(request.headers))        # what goes on the wire
        return httpx.Response(200, json={
            "id": "x", "object": "chat.completion", "created": 0, "model": "m",
            "choices": [{"index": 0, "finish_reason": "stop", "message": {"role": "assistant", "content": "ok"}}]})

    monkeypatch.setenv("N_FACTORY_ACC_KEY", "test-key")
    llm.get_settings.cache_clear()
    llm._http_clients.cache_clear()
    monkeypatch.setattr(llm, "_http_clients", lambda: (
        httpx.Client(transport=httpx.MockTransport(handler), event_hooks=llm.HOOKS),
        httpx.AsyncClient(transport=httpx.MockTransport(handler), event_hooks=llm.ASYNC_HOOKS)))
    try:
        model = llm.chat_model("super", max_tokens=10)
        assert model.invoke("hi").content == "ok"
        assert asyncio.run(model.ainvoke("hi")).content == "ok"
    finally:
        llm.get_settings.cache_clear()
    assert len(seen) == 2 and all("x-stainless-raw-response" not in h for h in seen)
