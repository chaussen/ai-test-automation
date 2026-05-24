# AI Test Automation POC

A proof-of-concept agentic workflow that automates the test engineer's core activities: reading a user story, designing test cases, writing runnable Playwright scripts, executing them, and saving a report — all driven by a local LLM.

This is a minimal replica of tools like ContextQA, built entirely from custom components that run inside an organisation with no data leaving the machine.

---

## Concept

```
┌─────────────────────────────────────────────────────────────┐
│  Local LLM server  (DeepSeek API for demo / Ollama locally) │
└──────────────────────────┬──────────────────────────────────┘
                           │  OpenAI-compatible API
┌──────────────────────────▼──────────────────────────────────┐
│  Orchestrator Agent  (orchestrator.py)                      │
│                                                             │
│  • Holds conversation state (system prompt + message log)   │
│  • Converts MCP tool schemas → LLM function-call format     │
│  • Drives the tool-use loop until the workflow is complete  │
└───┬──────────────────────────────────────────────────────┬──┘
    │  stdio (MCP protocol)                                │
┌───▼──────────────────────────────────────────────────────▼──┐
│  Local MCP Server  (mcp_server.py)                          │
│                                                             │
│  list_stories / read_story   →  stories/*.md               │
│  scrape_page(url)            →  headless Playwright         │
│  save_test_cases             →  output/test_cases/          │
│  save_script                 →  output/scripts/             │
│  run_test                    →  pytest-playwright           │
│  save_report                 →  output/reports/             │
└─────────────────────────────────────────────────────────────┘
    │  local filesystem
┌───▼─────────────────────────────────────────────────────────┐
│  Trigger  (main.py)                                         │
│                                                             │
│  python main.py user_login      ← one-shot CLI              │
│  python main.py --watch         ← file watcher              │
└─────────────────────────────────────────────────────────────┘
```

---

## Key Components

### `mcp_server.py` — Local MCP Server

A **custom-built** [Model Context Protocol](https://modelcontextprotocol.io) server written in Python. It exposes 7 tools to the agent:

| Tool | What it does |
|------|-------------|
| `list_stories` | Scans `stories/` and returns available story names |
| `read_story` | Reads a story markdown file by name |
| `scrape_page` | Launches headless Chromium, visits a URL, and extracts every interactive element with its CSS/ID selector |
| `save_test_cases` | Writes the agent's designed test cases to `output/test_cases/` |
| `save_script` | Writes the agent's generated pytest-playwright script to `output/scripts/` |
| `run_test` | Runs the saved script with `pytest` and returns structured pass/fail output |
| `save_report` | Writes the final test report to `output/reports/` with a timestamp |

The server communicates over **stdio** using the MCP protocol. In a production deployment it would run as a persistent process on the local machine, connected over SSE. The code does not change — only the transport.

### `orchestrator.py` — Agent

A **custom-built** agentic loop. It:

1. Spawns `mcp_server.py` as a subprocess and connects via the MCP client
2. Reads the tool list from the server and converts the schemas to OpenAI function-call format
3. Sends the initial task to the LLM with the full tool list attached
4. Receives the LLM's response; if it contains tool calls, executes each one via the MCP session and feeds the results back
5. Repeats until the LLM stops calling tools (workflow complete) or the iteration limit is reached

The agent uses an **OpenAI-compatible API client**, which means the LLM endpoint is fully swappable via `.env` — no code changes required.

### `prompts/system.md` — Agent Context

The system prompt that gives the agent its identity and workflow. It defines:
- The 6-step testing process the agent must follow
- The exact markdown format for test cases
- The exact Python format for generated scripts (AAA pattern, `expect()` assertions, naming conventions)
- The report structure

### `main.py` — Trigger

Two modes:

- **One-shot**: `python main.py <story_name>` — runs the full workflow for one story and exits
- **Watch**: `python main.py --watch` — polls `stories/` every 5 seconds; any new `.md` file automatically triggers a full run

---

## Workflow (what happens when you run it)

```
1. read_story("user_login")
        ↓
   Agent reads acceptance criteria and target URL from the story file

2. scrape_page("https://www.saucedemo.com")
        ↓
   Headless browser visits the URL and returns real selectors:
   #user-name, #password, #login-button, [data-test=error], ...

3. Agent reasons → save_test_cases("user_login", "...")
        ↓
   output/test_cases/user_login.md  (TC-01, TC-02, TC-03, ...)

4. Agent reasons → save_script("user_login", "...")
        ↓
   output/scripts/test_user_login.py  (pytest-playwright, AAA pattern)

5. run_test("user_login")
        ↓
   pytest runs the script against the live site; returns pass/fail per test

6. Agent reasons → save_report("user_login", "...")
        ↓
   output/reports/user_login_20260524_004833.md
```

Steps 3, 4, and 6 are pure LLM reasoning. Steps 1, 2, and 5 are deterministic tool calls. The agent decides the order.

---

## Setup

**Requirements**: Python 3.11+

```bash
# 1. Install dependencies
pip install -r requirements.txt

# 2. Install the Playwright browser
python -m playwright install chromium

# 3. Configure the LLM
cp .env.example .env
# Edit .env and set LLM_API_KEY
```

### `.env` options

```bash
# DeepSeek API (demo default)
LLM_BASE_URL=https://api.deepseek.com
LLM_API_KEY=sk-...
LLM_MODEL=deepseek-chat

# Local Ollama — swap these in, nothing else changes
# LLM_BASE_URL=http://localhost:11434/v1
# LLM_API_KEY=ollama
# LLM_MODEL=llama3.2

# Only needed if Playwright browsers are installed outside ~/.cache
# PLAYWRIGHT_BROWSERS_PATH=/opt/pw-browsers
```

The `LLM_BASE_URL` / `LLM_MODEL` / `LLM_API_KEY` pattern works for any OpenAI-compatible endpoint: DeepSeek, Ollama, vLLM, LM Studio, OpenAI itself.

---

## Usage

```bash
# List available stories
python main.py --list

# Run the full workflow for one story
python main.py user_login
python main.py add_to_cart

# Watch stories/ and auto-trigger on new .md files
python main.py --watch

# Watch a custom directory
python main.py --watch /path/to/stories
```

### Adding a new story

Create `stories/my_feature.md` following this structure:

```markdown
# User Story: My Feature

**As a** user, **I want to** ..., **So that** ...

## Target URL
https://your-app.example.com/page

## Acceptance Criteria
- Criterion one
- Criterion two

## Test Data
| Scenario | Input | Expected |
|----------|-------|----------|
| Happy path | valid@email.com | Success message shown |
```

Then run:

```bash
python main.py my_feature
# or drop the file into stories/ while --watch is running
```

---

## Output artefacts

| Path | Content |
|------|---------|
| `output/test_cases/<name>.md` | Structured test cases designed by the agent |
| `output/scripts/test_<name>.py` | Runnable pytest-playwright script |
| `output/reports/<name>_<timestamp>.md` | Execution report with pass/fail table |

Generated scripts can be run independently at any time:

```bash
python -m pytest output/scripts/test_user_login.py -v
```

---

## Project structure

```
ai-test-automation/
├── main.py               # CLI entry point + file watcher
├── orchestrator.py       # Custom agent loop
├── mcp_server.py         # Custom local MCP server (7 tools)
├── config.py             # LLM + path configuration
├── conftest.py           # pytest-playwright browser settings
├── pytest.ini            # Default pytest options
├── requirements.txt
├── .env.example
├── prompts/
│   └── system.md         # Agent system prompt (workflow + formatting rules)
├── stories/              # Input: user story files
│   ├── user_login.md
│   └── add_to_cart.md
└── output/               # Generated artefacts (git-ignored)
    ├── test_cases/
    ├── scripts/
    └── reports/
```

---

## Scope notes

**This POC covers**: story ingestion → page scraping → test case design → script generation → execution → reporting.

**Not included** (intentional for POC simplicity):
- Screenshots on failure
- Multi-page / cross-page flow testing
- Test data management (fixtures, factories)
- Historical result tracking (database)
- Notifications (Slack, email)
- Environment configuration (staging vs prod)
- HTML report output

Any of these can be added as a new MCP tool in `mcp_server.py` — the agent will automatically discover and use it without any changes to the orchestrator.
