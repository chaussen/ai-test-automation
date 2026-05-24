"""
Orchestrator agent.

Connects to the local MCP server over stdio, then runs an agentic loop using
the configured LLM (DeepSeek API for demo; swap .env to point at local Ollama
to run fully offline — the code does not change).
"""

import asyncio
import json
import sys
from pathlib import Path

from mcp import ClientSession, StdioServerParameters
from mcp.client.stdio import stdio_client
from openai import AsyncOpenAI

import config

SYSTEM_PROMPT = (Path(__file__).parent / "prompts" / "system.md").read_text()
MAX_ITERATIONS = 25


def _mcp_to_openai_tools(mcp_tools) -> list[dict]:
    return [
        {
            "type": "function",
            "function": {
                "name": t.name,
                "description": t.description or "",
                "parameters": t.inputSchema,
            },
        }
        for t in mcp_tools
    ]


async def run_agent(story_name: str) -> None:
    llm = AsyncOpenAI(api_key=config.LLM_API_KEY, base_url=config.LLM_BASE_URL)

    server_params = StdioServerParameters(
        command=sys.executable,
        args=[str(Path(__file__).parent / "mcp_server.py")],
    )

    print(f"\n{'='*60}")
    print(f"  Story : {story_name}")
    print(f"  Model : {config.LLM_MODEL}  ({config.LLM_BASE_URL})")
    print(f"{'='*60}\n")
    print("[orchestrator] starting MCP server...")

    async with stdio_client(server_params) as (read, write):
        async with ClientSession(read, write) as session:
            await session.initialize()

            tools_response = await session.list_tools()
            tools = _mcp_to_openai_tools(tools_response.tools)
            print(f"[orchestrator] tools: {[t['function']['name'] for t in tools]}\n")

            messages: list[dict] = [
                {"role": "system", "content": SYSTEM_PROMPT},
                {
                    "role": "user",
                    "content": (
                        f"Run the full test automation workflow for story: '{story_name}'.\n\n"
                        "Follow the workflow in your instructions step by step. "
                        "Use the scraped selectors verbatim in the script. "
                        "After running the tests, save the report and briefly summarise what happened."
                    ),
                },
            ]

            for iteration in range(1, MAX_ITERATIONS + 1):
                response = await llm.chat.completions.create(
                    model=config.LLM_MODEL,
                    messages=messages,
                    tools=tools,
                    tool_choice="auto",
                    max_tokens=4096,
                )

                msg = response.choices[0].message

                if msg.content:
                    print(f"\n[agent] {msg.content}")

                if not msg.tool_calls:
                    break

                # Append assistant turn
                messages.append({
                    "role": "assistant",
                    "content": msg.content,
                    "tool_calls": [
                        {
                            "id": tc.id,
                            "type": "function",
                            "function": {
                                "name": tc.function.name,
                                "arguments": tc.function.arguments,
                            },
                        }
                        for tc in msg.tool_calls
                    ],
                })

                # Execute each tool call and collect results
                for tc in msg.tool_calls:
                    func_name = tc.function.name
                    try:
                        args = json.loads(tc.function.arguments)
                    except json.JSONDecodeError:
                        args = {}

                    preview = ", ".join(
                        f"{k}={repr(v)[:50]}" for k, v in args.items()
                    )
                    print(f"\n  → {func_name}({preview})")

                    result = await session.call_tool(func_name, args)
                    content = result.content[0].text if result.content else ""

                    short = content if len(content) <= 300 else content[:300] + " …"
                    print(f"  ← {short}")

                    messages.append({
                        "role": "tool",
                        "tool_call_id": tc.id,
                        "content": content,
                    })

            else:
                print(f"\n[orchestrator] reached iteration limit ({MAX_ITERATIONS})")

    print(f"\n{'='*60}")
    print("  Workflow complete. Check output/ for artefacts.")
    print(f"{'='*60}\n")
