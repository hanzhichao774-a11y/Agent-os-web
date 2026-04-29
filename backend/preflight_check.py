#!/usr/bin/env python3
"""
部署前连通性预检脚本
用法:
    # 聊天模型
    python preflight_check.py --base-url http://your-host:8080/v1 --api-key sk-xxx --models qw3-235b qw3-32b qw3.5-397b

    # Embedding 模型
    python preflight_check.py --base-url http://your-host:8080/v1 --api-key sk-xxx --embedding-models qw3-em-8b

    # Reranker 模型
    python preflight_check.py --reranker-base-url http://your-host:8080 --reranker-api-key sk-xxx --reranker-models qw3-reranke-8b

    # 全部一起测
    python preflight_check.py --base-url http://your-host:8080/v1 --api-key sk-xxx \
        --models qw3-235b qw3-32b qw3.5-397b \
        --embedding-models qw3-em-8b \
        --reranker-base-url http://your-host:8080 --reranker-models qw3-reranke-8b
"""

import argparse
import asyncio
import sys

COMPAT_ROLE_MAP = {
    "system": "system",
    "user": "user",
    "assistant": "assistant",
    "tool": "tool",
    "model": "assistant",
}

GREEN = "\033[92m"
RED = "\033[91m"
YELLOW = "\033[93m"
RESET = "\033[0m"


def ok(msg: str):
    print(f"  {GREEN}✓ {msg}{RESET}")


def fail(msg: str):
    print(f"  {RED}✗ {msg}{RESET}")


def warn(msg: str):
    print(f"  {YELLOW}⚠ {msg}{RESET}")


def mask_key(key: str) -> str:
    if not key or len(key) <= 12:
        return key
    return key[:8] + "..." + key[-4:]


# ── Chat Model Tests ─────────────────────────────────────────────────────────

def test_raw_sdk(model_id: str, api_key: str, base_url: str) -> bool:
    from openai import OpenAI

    try:
        client = OpenAI(api_key=api_key, base_url=base_url, timeout=30)
        resp = client.chat.completions.create(
            model=model_id,
            messages=[
                {"role": "system", "content": "回复OK"},
                {"role": "user", "content": "ping"},
            ],
            max_tokens=20,
        )
        choice = resp.choices[0]
        content = choice.message.content or ""
        extra = getattr(choice.message, "reasoning_content", "") or ""
        if content.strip() or extra.strip():
            display = content.strip() or f"(reasoning) {extra.strip()}"
            ok(f"SDK 直连成功 → {display[:60]}")
            return True
        else:
            fail("SDK 直连返回空内容")
            return False
    except Exception as e:
        fail(f"SDK 直连失败 → {e}")
        return False


async def test_agno_agent(model_id: str, api_key: str, base_url: str) -> bool:
    from agno.models.openai import OpenAIChat
    from agno.agent import Agent

    try:
        model = OpenAIChat(
            id=model_id,
            api_key=api_key,
            base_url=base_url,
            role_map=COMPAT_ROLE_MAP,
            timeout=30,
        )
        agent = Agent(model=model, instructions=["请用一个词回复: OK"], markdown=False)
        resp = await agent.arun("ping", stream=False)
        content = resp.content or ""
        if content.strip() and "error" not in content.lower():
            ok(f"Agno Agent 测试成功 → {content.strip()[:60]}")
            return True
        else:
            fail(f"Agno Agent 返回异常 → {content.strip()[:120]}")
            return False
    except Exception as e:
        fail(f"Agno Agent 测试失败 → {e}")
        return False


# ── Embedding Tests ──────────────────────────────────────────────────────────

def test_embedding(model_id: str, api_key: str, base_url: str) -> bool:
    from openai import OpenAI

    try:
        client = OpenAI(api_key=api_key, base_url=base_url, timeout=30)
        resp = client.embeddings.create(
            model=model_id,
            input=["测试连通性"],
        )
        dim = len(resp.data[0].embedding)
        ok(f"Embedding 测试成功 → 返回向量维度: {dim}")
        return True
    except Exception as e:
        fail(f"Embedding 测试失败 → {e}")
        return False


# ── Reranker Tests ───────────────────────────────────────────────────────────

def test_reranker(model_id: str, api_key: str, base_url: str) -> bool:
    import httpx

    headers = {"Content-Type": "application/json"}
    if api_key:
        headers["Authorization"] = f"Bearer {api_key}"

    base = base_url.rstrip("/")
    if base.endswith("/v1"):
        base = base[:-3]
    query = "什么是人工智能"
    documents = ["人工智能是计算机科学的分支", "今天天气很好适合出去玩", "深度学习需要大量训练数据"]

    # Jina/Cohere: /v1/rerank
    jina_url = f"{base}/v1/rerank"
    jina_body = {"model": model_id, "query": query, "documents": documents, "top_n": 3}
    try:
        resp = httpx.post(jina_url, json=jina_body, headers=headers, timeout=30)
        if resp.status_code != 404:
            resp.raise_for_status()
            results = resp.json().get("results", [])
            if results:
                ok(f"Reranker 测试成功 (Jina 格式) → 返回 {len(results)} 条，最高分: {results[0].get('relevance_score', 'N/A')}")
                return True
    except httpx.HTTPStatusError as e:
        if e.response.status_code != 404:
            fail(f"Reranker 测试失败 (Jina 格式) → {e}")
            return False
    except httpx.ConnectError:
        pass

    # TEI: /rerank
    tei_url = f"{base}/rerank"
    tei_body = {"query": query, "texts": documents, "truncate": True}
    try:
        resp = httpx.post(tei_url, json=tei_body, headers=headers, timeout=30)
        resp.raise_for_status()
        data = resp.json()
        count = len(data) if isinstance(data, list) else len(data.get("results", []))
        ok(f"Reranker 测试成功 (TEI 格式) → 返回 {count} 条")
        return True
    except Exception as e:
        fail(f"Reranker 测试失败 → {e}")
        return False


# ── Main ─────────────────────────────────────────────────────────────────────

def main():
    parser = argparse.ArgumentParser(description="AgentOS 部署前连通性预检")
    parser.add_argument("--base-url", default="", help="聊天/Embedding 模型服务地址")
    parser.add_argument("--api-key", default="none", help="聊天/Embedding API Key")
    parser.add_argument("--models", nargs="+", default=[], help="聊天模型 model_id 列表")
    parser.add_argument("--embedding-models", nargs="+", default=[], help="Embedding model_id 列表")
    parser.add_argument("--reranker-base-url", default="", help="Reranker 服务地址（可能不带 /v1）")
    parser.add_argument("--reranker-api-key", default="", help="Reranker API Key（留空则复用 --api-key）")
    parser.add_argument("--reranker-models", nargs="+", default=[], help="Reranker model_id 列表")
    args = parser.parse_args()

    if not args.models and not args.embedding_models and not args.reranker_models:
        parser.error("至少指定一种模型: --models / --embedding-models / --reranker-models")

    reranker_api_key = args.reranker_api_key or args.api_key

    print(f"\n{'='*60}")
    print(f"  AgentOS 部署预检")
    if args.base_url:
        print(f"  Base URL        : {args.base_url}")
    print(f"  API Key         : {mask_key(args.api_key)}")
    if args.models:
        print(f"  聊天模型        : {', '.join(args.models)}")
    if args.embedding_models:
        print(f"  Embedding 模型  : {', '.join(args.embedding_models)}")
    if args.reranker_models:
        print(f"  Reranker 模型   : {', '.join(args.reranker_models)}")
        print(f"  Reranker URL    : {args.reranker_base_url or args.base_url}")
    print(f"{'='*60}\n")

    results: dict[str, bool] = {}

    for model_id in args.models:
        print(f"▸ 聊天模型: {model_id}")
        sdk_ok = test_raw_sdk(model_id, args.api_key, args.base_url)
        agent_ok = asyncio.run(test_agno_agent(model_id, args.api_key, args.base_url))
        results[f"chat:{model_id}"] = sdk_ok and agent_ok
        print()

    for model_id in args.embedding_models:
        print(f"▸ Embedding: {model_id}")
        results[f"embed:{model_id}"] = test_embedding(model_id, args.api_key, args.base_url)
        print()

    reranker_url = args.reranker_base_url or args.base_url
    for model_id in args.reranker_models:
        print(f"▸ Reranker: {model_id}")
        results[f"rerank:{model_id}"] = test_reranker(model_id, reranker_api_key, reranker_url)
        print()

    print(f"{'='*60}")
    print("  汇总结果:")
    all_pass = True
    for label, passed in results.items():
        status = f"{GREEN}PASS{RESET}" if passed else f"{RED}FAIL{RESET}"
        print(f"    {label:40s} [{status}]")
        if not passed:
            all_pass = False

    print(f"{'='*60}")
    if all_pass:
        print(f"\n  {GREEN}所有模型预检通过，可以部署！{RESET}\n")
    else:
        print(f"\n  {RED}存在失败项，请排查后再部署{RESET}\n")
        sys.exit(1)


if __name__ == "__main__":
    main()
