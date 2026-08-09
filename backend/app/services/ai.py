from __future__ import annotations

import json
import os
from collections.abc import AsyncIterator

import httpx

HF_API_URL = "https://router.huggingface.co/v1/chat/completions"
ANTHROPIC_API_URL = "https://api.anthropic.com/v1/messages"
DEFAULT_HF_MODEL = "Qwen/Qwen2.5-Coder-32B-Instruct:cheapest"
DEFAULT_ANTHROPIC_MODEL = "claude_sonnet_4_6"


def get_configured_provider() -> str | None:
    explicit_provider = os.environ.get("AI_PROVIDER", "").strip().lower()
    if explicit_provider in {"huggingface", "hf"}:
        return "huggingface"
    if explicit_provider == "anthropic":
        return "anthropic"

    if get_huggingface_key():
        return "huggingface"
    if os.environ.get("ANTHROPIC_API_KEY"):
        return "anthropic"
    return None


def get_huggingface_key() -> str | None:
    return (
        os.environ.get("HF_API_KEY")
        or os.environ.get("HF_TOKEN")
        or os.environ.get("HUGGINGFACE_API_KEY")
    )


def get_huggingface_model() -> str:
    return os.environ.get("HF_MODEL") or os.environ.get("HUGGINGFACE_MODEL") or DEFAULT_HF_MODEL


def get_anthropic_model() -> str:
    return os.environ.get("ANTHROPIC_MODEL") or DEFAULT_ANTHROPIC_MODEL


def get_max_tokens() -> int:
    raw = os.environ.get("AI_MAX_TOKENS", "1024")
    try:
        parsed = int(raw)
    except ValueError:
        return 1024
    return parsed if parsed > 0 else 1024


def get_temperature() -> float:
    raw = os.environ.get("AI_TEMPERATURE", "0.2")
    try:
        return float(raw)
    except ValueError:
        return 0.2


def get_chat_provider_label() -> str:
    provider = get_configured_provider()
    if provider == "huggingface":
        return get_huggingface_model()
    if provider == "anthropic":
        return get_anthropic_model()
    return "unconfigured"


def extract_hf_delta_text(payload: dict) -> str:
    delta = payload.get("choices", [{}])[0].get("delta")
    if not isinstance(delta, dict):
        return ""
    content = delta.get("content")
    if isinstance(content, str):
        return content
    if isinstance(content, list):
        return "".join(part.get("text", "") for part in content if isinstance(part, dict))
    return ""


async def stream_huggingface_chat(
    system_prompt: str, messages: list[dict[str, str]]
) -> AsyncIterator[str]:
    api_key = get_huggingface_key()
    if not api_key:
        raise RuntimeError("HF_API_KEY is not set")

    async with httpx.AsyncClient(timeout=httpx.Timeout(60.0, connect=10.0)) as client:
        async with client.stream(
            "POST",
            HF_API_URL,
            headers={
                "Authorization": f"Bearer {api_key}",
                "Content-Type": "application/json",
            },
            json={
                "model": get_huggingface_model(),
                "messages": [{"role": "system", "content": system_prompt}, *messages],
                "max_tokens": get_max_tokens(),
                "temperature": get_temperature(),
                "stream": True,
            },
        ) as response:
            response.raise_for_status()
            async for line in response.aiter_lines():
                if not line.startswith("data:"):
                    continue
                payload = line[5:].strip()
                if not payload:
                    continue
                if payload == "[DONE]":
                    break
                text = extract_hf_delta_text(json.loads(payload))
                if text:
                    yield text


async def stream_anthropic_chat(
    system_prompt: str, messages: list[dict[str, str]]
) -> AsyncIterator[str]:
    api_key = os.environ.get("ANTHROPIC_API_KEY")
    if not api_key:
        raise RuntimeError("ANTHROPIC_API_KEY is not set")

    async with httpx.AsyncClient(timeout=httpx.Timeout(60.0, connect=10.0)) as client:
        async with client.stream(
            "POST",
            ANTHROPIC_API_URL,
            headers={
                "x-api-key": api_key,
                "anthropic-version": "2023-06-01",
                "content-type": "application/json",
            },
            json={
                "model": get_anthropic_model(),
                "max_tokens": get_max_tokens(),
                "system": system_prompt,
                "messages": messages,
                "stream": True,
            },
        ) as response:
            response.raise_for_status()
            async for line in response.aiter_lines():
                if not line.startswith("data:"):
                    continue
                payload = line[5:].strip()
                if not payload:
                    continue
                parsed = json.loads(payload)
                if parsed.get("type") == "content_block_delta":
                    delta = parsed.get("delta", {})
                    if delta.get("type") == "text_delta" and isinstance(delta.get("text"), str):
                        yield delta["text"]


async def stream_chat_response(
    *,
    system_prompt: str,
    messages: list[dict[str, str]],
) -> AsyncIterator[str]:
    provider = get_configured_provider()
    if provider == "huggingface":
        async for chunk in stream_huggingface_chat(system_prompt, messages):
            yield chunk
        return
    if provider == "anthropic":
        async for chunk in stream_anthropic_chat(system_prompt, messages):
            yield chunk
        return
    raise RuntimeError("No AI provider is configured. Set HF_API_KEY or ANTHROPIC_API_KEY.")
