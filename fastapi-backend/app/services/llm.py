"""
LLM router — Python port of supabase/functions/_shared/llm.ts
Routes calls between OpenAI and Anthropic (Claude) with cross-provider fallback.
Normalises both APIs to the OpenAI chat-completions response shape.
"""
import asyncio
import json
import re
import time
import logging
from typing import Any, Optional, AsyncIterator
from dataclasses import dataclass, field

import httpx

from app.config import settings

logger = logging.getLogger(__name__)

WORKFLOW_ROUTING: dict[str, dict] = {
    # LOCKED — streaming chat must stay on OpenAI
    "norman-chat":               {"primary": "openai", "fallback": "openai", "locked": True},
    "chat-with-project-context": {"primary": "openai", "fallback": "openai", "locked": True},

    # LOCKED — Duncan voice/style fidelity
    "gmail-auto-draft":          {"primary": "claude", "fallback": "claude", "locked": True},
    "gmail-train-style":         {"primary": "claude", "fallback": "claude", "locked": True},

    # Claude primary
    "ceo-briefing":              {"primary": "claude", "fallback": "openai"},
    "ceo-email-pulse":           {"primary": "claude", "fallback": "openai"},
    "analyze-meeting":           {"primary": "claude", "fallback": "openai"},
    "finalize-release":          {"primary": "claude", "fallback": "openai"},
    "generate-exec-summary":     {"primary": "claude", "fallback": "openai"},
    "hireflix-sync-interviews":  {"primary": "claude", "fallback": "openai"},
    "hireflix-retry-processor":  {"primary": "claude", "fallback": "openai"},
    "create-hireflix-position":  {"primary": "claude", "fallback": "openai"},
    "score-cv-values":           {"primary": "claude", "fallback": "openai"},
    "score-cv-competencies":     {"primary": "claude", "fallback": "openai"},
    "claude-test":               {"primary": "claude", "fallback": "openai"},

    # OpenAI primary
    "generate-jd":               {"primary": "openai", "fallback": "claude"},
    "parse-jd-competencies":     {"primary": "openai", "fallback": "claude"},
    "extract-chat-file":         {"primary": "openai", "fallback": "claude"},
    "extract-file-text":         {"primary": "openai", "fallback": "claude"},
    "parse-cv":                  {"primary": "openai", "fallback": "claude"},
    "google-analytics":          {"primary": "openai", "fallback": "claude"},

    "generic":                   {"primary": "openai", "fallback": "claude"},
}

WORKFLOW_PRIMARY_MODEL: dict[str, dict] = {
    "parse-cv":              {"openai": "gpt-4o-mini"},
    "parse-jd-competencies": {"openai": "gpt-4o-mini"},
    "extract-file-text":     {"openai": "gpt-4o-mini"},
    "extract-chat-file":     {"openai": "gpt-4o-mini"},
    "google-analytics":      {"openai": "gpt-4o-mini"},
    "score-cv-values":       {"claude": "claude-haiku-4-5"},
    "score-cv-competencies": {"claude": "claude-haiku-4-5"},
}

PROVIDER_TIMEOUT_DEFAULTS: dict[str, int] = {
    "ceo-briefing": 240,
}

CLAUDE_MODEL_PRIMARY = "claude-sonnet-4-5-20250929"
CLAUDE_MODEL_DEGRADE = "claude-haiku-4-5"
OPENAI_MODEL_PRIMARY = "gpt-4o"
OPENAI_MODEL_DEGRADE = "gpt-4o-mini"


@dataclass
class LLMMessage:
    role: str
    content: Any
    tool_calls: Optional[list] = None
    tool_call_id: Optional[str] = None
    name: Optional[str] = None


@dataclass
class LLMTool:
    type: str
    function: dict


@dataclass
class CallLLMOptions:
    workflow: str
    messages: list[dict]
    tools: Optional[list[dict]] = None
    tool_choice: Any = None
    max_tokens: Optional[int] = None
    temperature: Optional[float] = None
    response_format: Optional[dict] = None
    force_provider: Optional[str] = None
    model_override: Optional[dict] = None


@dataclass
class NormalisedResponse:
    choices: list[dict]
    usage: Optional[dict] = None
    _provider: str = "openai"
    _model: str = ""


def _timeout_for(workflow: str) -> int:
    return PROVIDER_TIMEOUT_DEFAULTS.get(workflow, 60)


def _pick_model(provider: str, opts: CallLLMOptions, degrade: bool = False) -> str:
    if opts.model_override and opts.model_override.get(provider):
        return opts.model_override[provider]
    if not degrade:
        wf_model = WORKFLOW_PRIMARY_MODEL.get(opts.workflow, {}).get(provider)
        if wf_model:
            return wf_model
    if provider == "claude":
        return CLAUDE_MODEL_DEGRADE if degrade else CLAUDE_MODEL_PRIMARY
    return OPENAI_MODEL_DEGRADE if degrade else OPENAI_MODEL_PRIMARY


def _extract_json(raw: str) -> str:
    cleaned = re.sub(r"^```(?:json)?\s*", "", raw.strip(), flags=re.IGNORECASE)
    cleaned = re.sub(r"\s*```$", "", cleaned, flags=re.IGNORECASE)
    obj_start = cleaned.find("{")
    arr_start = cleaned.find("[")
    starts = [s for s in [obj_start, arr_start] if s >= 0]
    if not starts:
        return cleaned
    return cleaned[min(starts):]


def _is_empty_response(res: dict) -> bool:
    choices = res.get("choices", [])
    if not choices:
        return True
    msg = choices[0].get("message", {})
    return not msg.get("content") and not msg.get("tool_calls")


# ---------- OpenAI ----------

async def _call_openai(opts: CallLLMOptions, model: str) -> dict:
    key = settings.OPENAI_API_KEY
    if not key:
        raise ValueError("OPENAI_API_KEY not configured")

    body: dict = {"model": model, "messages": opts.messages}
    if opts.tools:
        body["tools"] = opts.tools
    if opts.tool_choice is not None:
        body["tool_choice"] = opts.tool_choice
    if opts.max_tokens:
        if model.startswith("gpt-5"):
            body["max_completion_tokens"] = opts.max_tokens
        else:
            body["max_tokens"] = opts.max_tokens
    if opts.temperature is not None and not model.startswith("gpt-5"):
        body["temperature"] = opts.temperature
    if opts.response_format:
        body["response_format"] = opts.response_format

    timeout = _timeout_for(opts.workflow)
    async with httpx.AsyncClient(timeout=timeout) as client:
        resp = await client.post(
            "https://api.openai.com/v1/chat/completions",
            headers={"Authorization": f"Bearer {key}", "Content-Type": "application/json"},
            json=body,
        )
    if not resp.is_success:
        err = Exception(f"OpenAI {resp.status_code}: {resp.text[:300]}")
        err.status = resp.status_code  # type: ignore[attr-defined]
        raise err

    data = resp.json()
    data["_provider"] = "openai"
    data["_model"] = model
    return data


# ---------- Anthropic / Claude ----------

def _to_anthropic_messages(messages: list[dict]) -> tuple[Optional[str], list[dict]]:
    system = None
    out = []
    for m in messages:
        if m["role"] == "system":
            content = m["content"] if isinstance(m["content"], str) else json.dumps(m["content"])
            system = f"{system}\n\n{content}" if system else content
            continue

        if m["role"] == "tool":
            out.append({
                "role": "user",
                "content": [{
                    "type": "tool_result",
                    "tool_use_id": m.get("tool_call_id"),
                    "content": m["content"] if isinstance(m["content"], str) else json.dumps(m["content"]),
                }],
            })
            continue

        if m["role"] == "assistant" and m.get("tool_calls"):
            blocks: list[dict] = []
            if isinstance(m.get("content"), str) and m["content"].strip():
                blocks.append({"type": "text", "text": m["content"]})
            for tc in m["tool_calls"]:
                try:
                    args = tc["function"]["arguments"]
                    inp = json.loads(args) if isinstance(args, str) else args
                except Exception:
                    inp = {}
                blocks.append({"type": "tool_use", "id": tc["id"], "name": tc["function"]["name"], "input": inp})
            out.append({"role": "assistant", "content": blocks})
            continue

        out.append({
            "role": m["role"],
            "content": m["content"] if isinstance(m["content"], str) else json.dumps(m["content"]),
        })

    return system, out


def _to_anthropic_tools(tools: Optional[list[dict]]) -> Optional[list[dict]]:
    if not tools:
        return None
    return [
        {
            "name": t["function"]["name"],
            "description": t["function"].get("description", ""),
            "input_schema": t["function"]["parameters"],
        }
        for t in tools
    ]


def _from_anthropic_response(data: dict, model: str) -> dict:
    blocks = data.get("content", []) if isinstance(data.get("content"), list) else []
    text = ""
    tool_calls = []
    for b in blocks:
        if b["type"] == "text":
            text += b["text"]
        elif b["type"] == "tool_use":
            tool_calls.append({
                "id": b["id"],
                "type": "function",
                "function": {"name": b["name"], "arguments": json.dumps(b.get("input", {}))},
            })

    stop = data.get("stop_reason", "stop")
    finish = "tool_calls" if stop == "tool_use" else ("stop" if stop == "end_turn" else stop)

    msg: dict = {"role": "assistant", "content": text or None}
    if tool_calls:
        msg["tool_calls"] = tool_calls

    usage = None
    if data.get("usage"):
        u = data["usage"]
        usage = {
            "prompt_tokens": u.get("input_tokens"),
            "completion_tokens": u.get("output_tokens"),
            "total_tokens": (u.get("input_tokens") or 0) + (u.get("output_tokens") or 0),
        }

    return {
        "choices": [{"message": msg, "finish_reason": finish}],
        "usage": usage,
        "_provider": "claude",
        "_model": model,
    }


async def _call_claude(opts: CallLLMOptions, model: str) -> dict:
    key = settings.ANTHROPIC_API_KEY
    if not key:
        raise ValueError("ANTHROPIC_API_KEY not configured")

    system, messages = _to_anthropic_messages(opts.messages)
    body: dict = {
        "model": model,
        "max_tokens": opts.max_tokens or 4096,
        "messages": messages,
    }
    if system:
        body["system"] = system
    if opts.temperature is not None:
        body["temperature"] = opts.temperature
    tools = _to_anthropic_tools(opts.tools)
    if tools:
        body["tools"] = tools

    timeout = _timeout_for(opts.workflow)
    async with httpx.AsyncClient(timeout=timeout) as client:
        resp = await client.post(
            "https://api.anthropic.com/v1/messages",
            headers={
                "x-api-key": key,
                "anthropic-version": "2023-06-01",
                "Content-Type": "application/json",
            },
            json=body,
        )

    if not resp.is_success:
        err = Exception(f"Anthropic {resp.status_code}: {resp.text[:300]}")
        err.status = resp.status_code  # type: ignore[attr-defined]
        raise err

    return _from_anthropic_response(resp.json(), model)


# ---------- Public API ----------

async def _call_provider(provider: str, opts: CallLLMOptions, degrade: bool = False) -> dict:
    model = _pick_model(provider, opts, degrade)
    if provider == "claude":
        return await _call_claude(opts, model)
    return await _call_openai(opts, model)


def _should_same_provider_retry(status: Optional[int]) -> bool:
    if not status:
        return True
    return status == 429 or status >= 500


def _should_cross_provider_fallback(provider: str, status: Optional[int], message: str = "") -> bool:
    if not status:
        return True
    if provider == "claude" and status == 400 and any(
        w in message.lower() for w in ["credit balance", "insufficient", "quota"]
    ):
        return True
    if 400 <= status < 500:
        return False
    return status == 429 or status >= 500


async def call_llm(opts: CallLLMOptions) -> dict:
    route = WORKFLOW_ROUTING.get(opts.workflow, WORKFLOW_ROUTING["generic"])
    provider = opts.force_provider or route["primary"]
    start = time.time()
    try:
        res = await _call_provider(provider, opts)
        logger.info(f"[llm] workflow={opts.workflow} provider={provider} status=ok latency_ms={int((time.time()-start)*1000)}")
        return res
    except Exception as err:
        logger.error(f"[llm] workflow={opts.workflow} provider={provider} status=fail: {err}")
        raise


async def call_llm_with_fallback(opts: CallLLMOptions) -> dict:
    route = WORKFLOW_ROUTING.get(opts.workflow, WORKFLOW_ROUTING["generic"])
    primary = opts.force_provider or route["primary"]
    locked = route.get("locked", False) or bool(opts.force_provider)
    fallback = "claude" if primary == "openai" else "openai"

    last_err = None

    # Attempt 1: primary, full model
    try:
        res = await _call_provider(primary, opts, degrade=False)
        if not _is_empty_response(res):
            return res
        raise Exception("empty response")
    except Exception as err:
        last_err = err
        logger.warning(f"[llm] {opts.workflow} {primary} attempt=1 fail: {err}")
        status = getattr(err, "status", None)
        if not _should_same_provider_retry(status) and not _should_cross_provider_fallback(primary, status, str(err)):
            raise

    # Attempt 2: same provider retry
    status = getattr(last_err, "status", None)
    if _should_same_provider_retry(status):
        try:
            res = await _call_provider(primary, opts, degrade=False)
            if not _is_empty_response(res):
                return res
        except Exception as err:
            last_err = err
            logger.warning(f"[llm] {opts.workflow} {primary} attempt=2 fail: {err}")

    # Attempt 3: same provider, degraded model
    try:
        res = await _call_provider(primary, opts, degrade=True)
        if not _is_empty_response(res):
            return res
    except Exception as err:
        last_err = err
        logger.warning(f"[llm] {opts.workflow} {primary} attempt=3 degraded fail: {err}")

    # Attempt 4: cross-provider fallback
    status = getattr(last_err, "status", None)
    if locked or not _should_cross_provider_fallback(primary, status, str(last_err)):
        raise last_err

    try:
        res = await _call_provider(fallback, opts, degrade=False)
        if not _is_empty_response(res):
            return res
        raise Exception("empty response from fallback")
    except Exception as err:
        logger.error(f"[llm] {opts.workflow} {fallback} attempt=4 fallback fail: {err}")
        raise


async def stream_llm(opts: CallLLMOptions) -> AsyncIterator[str]:
    """Yield raw SSE lines from OpenAI streaming endpoint."""
    key = settings.OPENAI_API_KEY
    if not key:
        raise ValueError("OPENAI_API_KEY not configured")

    model = _pick_model("openai", opts)
    body: dict = {"model": model, "messages": opts.messages, "stream": True}
    if opts.tools:
        body["tools"] = opts.tools
    if opts.tool_choice is not None:
        body["tool_choice"] = opts.tool_choice
    if opts.max_tokens:
        if model.startswith("gpt-5"):
            body["max_completion_tokens"] = opts.max_tokens
        else:
            body["max_tokens"] = opts.max_tokens
    if opts.temperature is not None and not model.startswith("gpt-5"):
        body["temperature"] = opts.temperature

    timeout = _timeout_for(opts.workflow)
    async with httpx.AsyncClient(timeout=timeout) as client:
        async with client.stream(
            "POST",
            "https://api.openai.com/v1/chat/completions",
            headers={"Authorization": f"Bearer {key}", "Content-Type": "application/json"},
            json=body,
        ) as resp:
            if not resp.is_success:
                text = await resp.aread()
                err = Exception(f"OpenAI stream {resp.status_code}: {text[:200]}")
                err.status = resp.status_code  # type: ignore[attr-defined]
                raise err
            async for line in resp.aiter_lines():
                yield line
