"""
Local MCP server exposing test automation tools.

Concept: in a real internal deployment this server would run on a local machine
alongside the LLM inference server (Ollama, vLLM, etc.) and be connected over
stdio or SSE — no data leaves the organisation.

Tools:
  list_stories       – discover available user story files
  read_story         – read a story's markdown content
  scrape_page        – launch a headless browser and extract interactive element selectors
  save_test_cases    – persist designed test cases to output/test_cases/
  save_script        – persist a pytest-playwright script to output/scripts/
  run_test           – execute a saved script and return pytest output
  save_report        – persist a test report to output/reports/
"""

import asyncio
import json
import os
from datetime import datetime
from pathlib import Path

from dotenv import load_dotenv
from mcp.server.fastmcp import FastMCP
from playwright.async_api import async_playwright

load_dotenv()

# Allow overriding the browser install location (useful in sandboxed environments)
_browsers_path = os.getenv("PLAYWRIGHT_BROWSERS_PATH")
if _browsers_path:
    os.environ["PLAYWRIGHT_BROWSERS_PATH"] = _browsers_path

BASE_DIR = Path(__file__).parent
STORIES_DIR = BASE_DIR / "stories"
OUTPUT_DIR = BASE_DIR / "output"

mcp = FastMCP("test-automation-server")


# ── File tools ──────────────────────────────────────────────────────────────

@mcp.tool()
async def list_stories() -> str:
    """List all available user story files (returns JSON array of names without .md)."""
    stories = sorted(STORIES_DIR.glob("*.md"))
    return json.dumps([s.stem for s in stories])


@mcp.tool()
async def read_story(story_name: str) -> str:
    """Read a user story by name (omit the .md extension)."""
    path = STORIES_DIR / f"{story_name}.md"
    if not path.exists():
        available = [s.stem for s in STORIES_DIR.glob("*.md")]
        return f"ERROR: story '{story_name}' not found. Available: {available}"
    return path.read_text()


@mcp.tool()
async def save_test_cases(name: str, content: str) -> str:
    """Save designed test cases as markdown to output/test_cases/<name>.md."""
    path = OUTPUT_DIR / "test_cases" / f"{name}.md"
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(content)
    return f"Saved → {path.relative_to(BASE_DIR)}"


@mcp.tool()
async def save_script(name: str, content: str) -> str:
    """Save a pytest-playwright test script to output/scripts/test_<name>.py."""
    path = OUTPUT_DIR / "scripts" / f"test_{name}.py"
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(content)
    return f"Saved → {path.relative_to(BASE_DIR)}"


@mcp.tool()
async def save_report(name: str, content: str) -> str:
    """Save a test report to output/reports/<name>_<timestamp>.md."""
    timestamp = datetime.now().strftime("%Y%m%d_%H%M%S")
    path = OUTPUT_DIR / "reports" / f"{name}_{timestamp}.md"
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(content)
    return f"Saved → {path.relative_to(BASE_DIR)}"


# ── Browser tools ────────────────────────────────────────────────────────────

@mcp.tool()
async def scrape_page(url: str) -> str:
    """
    Visit a URL with a headless browser and extract all interactive elements.

    Returns JSON with:
      - url, title
      - elements: list of {tag, type, id, selector, text, placeholder}

    Use the returned selectors when writing Playwright test scripts.
    """
    try:
        async with async_playwright() as pw:
            browser = await pw.chromium.launch()
            ctx = await browser.new_context(ignore_https_errors=True)
            page = await ctx.new_page()
            await page.goto(url, wait_until="domcontentloaded", timeout=30000)
            await page.wait_for_timeout(800)

            elements = await page.evaluate("""() => {
                const seen = new Set();
                const results = [];
                const nodes = document.querySelectorAll(
                    'input, button, a[href], select, textarea, [role="button"]'
                );
                nodes.forEach(el => {
                    let selector = null;
                    if (el.id)
                        selector = '#' + el.id;
                    else if (el.getAttribute('data-test'))
                        selector = '[data-test="' + el.getAttribute('data-test') + '"]';
                    else if (el.name)
                        selector = '[name="' + el.name + '"]';
                    else if (el.placeholder)
                        selector = '[placeholder="' + el.placeholder + '"]';

                    if (!selector || seen.has(selector)) return;
                    seen.add(selector);

                    results.push({
                        tag: el.tagName.toLowerCase(),
                        type: el.type || null,
                        id: el.id || null,
                        selector,
                        text: (el.textContent || '').trim().slice(0, 60),
                        placeholder: el.placeholder || null,
                    });
                });
                return results;
            }""")

            title = await page.title()
            await ctx.close()
            await browser.close()

            return json.dumps({"url": url, "title": title, "elements": elements}, indent=2)

    except Exception as exc:
        return f"ERROR scraping {url}: {exc}"


# ── Test execution ────────────────────────────────────────────────────────────

@mcp.tool()
async def run_test(script_name: str) -> str:
    """
    Execute a saved test script with pytest-playwright.

    script_name: the name used in save_script (without the test_ prefix and .py).
    Returns JSON with {passed, exit_code, output, errors}.
    """
    script_path = OUTPUT_DIR / "scripts" / f"test_{script_name}.py"
    if not script_path.exists():
        return f"ERROR: script 'test_{script_name}.py' not found in output/scripts/"

    try:
        env = os.environ.copy()
        proc = await asyncio.create_subprocess_exec(
            "python", "-m", "pytest", str(script_path),
            "-v", "--tb=short", "--no-header",
            cwd=str(BASE_DIR),
            env=env,
            stdout=asyncio.subprocess.PIPE,
            stderr=asyncio.subprocess.PIPE,
        )
        stdout, stderr = await asyncio.wait_for(proc.communicate(), timeout=120)
        return json.dumps({
            "passed": proc.returncode == 0,
            "exit_code": proc.returncode,
            "output": stdout.decode("utf-8", errors="replace"),
            "errors": stderr.decode("utf-8", errors="replace"),
        })
    except asyncio.TimeoutError:
        return json.dumps({"passed": False, "exit_code": -1, "output": "", "errors": "Test run timed out after 120s"})


if __name__ == "__main__":
    mcp.run()
