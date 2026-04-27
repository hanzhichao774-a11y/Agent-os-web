#!/usr/bin/env python3
"""
部署前连通性预检脚本
用法:
    python preflight_check.py --base-url http://your-host:8080/v1 --api-key sk-xxx --models qw3-235b qw3-32b qw3.5-397b

会依次对每个模型执行:
  1. 原生 OpenAI SDK 直连测试（排除框架干扰）
  2. Agno OpenAIChat + Agent 全链路测试（模拟真实业务调用）
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


def test_raw_sdk(model_id: str, api_key: str, base_url: str) -> bool:
    """原生 OpenAI SDK 直连"""
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
    """Agno Agent 全链路测试"""
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


def main():
    parser = argparse.ArgumentParser(description="AgentOS 部署前连通性预检")
    parser.add_argument("--base-url", required=True, help="LLM 服务地址，例如 http://192.168.1.100:8080/v1")
    parser.add_argument("--api-key", default="none", help="API Key（无鉴权可留空）")
    parser.add_argument("--models", nargs="+", required=True, help="要测试的 model_id 列表")
    args = parser.parse_args()

    print(f"\n{'='*60}")
    print(f"  AgentOS 部署预检")
    print(f"  Base URL : {args.base_url}")
    print(f"  API Key  : {args.api_key[:8]}...{args.api_key[-4:]}" if len(args.api_key) > 12 else f"  API Key  : {args.api_key}")
    print(f"  Models   : {', '.join(args.models)}")
    print(f"{'='*60}\n")

    results = {}

    for model_id in args.models:
        print(f"▸ 测试模型: {model_id}")

        sdk_ok = test_raw_sdk(model_id, args.api_key, args.base_url)
        agent_ok = asyncio.run(test_agno_agent(model_id, args.api_key, args.base_url))
        results[model_id] = sdk_ok and agent_ok
        print()

    print(f"{'='*60}")
    print("  汇总结果:")
    all_pass = True
    for model_id, passed in results.items():
        status = f"{GREEN}PASS{RESET}" if passed else f"{RED}FAIL{RESET}"
        print(f"    {model_id:30s} [{status}]")
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
