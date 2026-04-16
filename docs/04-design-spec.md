# AI Test Automation — POC Design Specification

---

## 1. System Overview

The POC is an AI-powered test automation pipeline that accepts a URL, a typed roles file, and natural language test steps, and autonomously produces and executes Playwright tests — with no selectors, no human element curation, and no coding required from the user.

**Core flow:**
```
roles.ts + steps.ts + URL
         ↓
  [Auth]       →  Login as specified role
         ↓
  [Discovery]  →  Accessibility tree snapshot → Element Library
         ↓
  [Generator]  →  LLM maps steps to elements → Playwright TS script (cached)
         ↓
  [Executor]   →  Run script → Pass / Fail
         ↓
  [Healer]     →  On fail: re-discover → re-generate → retry once
         ↓
  [Reporter]   →  HTML report + JSON results
```

---

## 2. Technology Stack

| Concern | Choice | Reason |
|---|---|---|
| Language | **TypeScript** | Playwright-native; roles/steps config files are `.ts`; generated scripts are `.ts`; full stack consistency |
| Browser automation | **Playwright** | Best accessibility tree API, native AI agents (Planner/Generator/Healer as reference), MCP support, most mature |
| LLM (script generation) | **Claude Sonnet 4.6** (`claude-sonnet-4-6`) | Best code generation quality; large context window fits accessibility tree + multi-step scripts |
| LLM (element resolution / enrichment) | **Claude Haiku 4.5** (`claude-haiku-4-5-20251001`) | Fast and cheap for lighter semantic matching tasks |
| Pipeline orchestration | **LangGraph.js** (`@langchain/langgraph`) | State machine graph pattern; conditional branching (heal vs. report); durable execution; TypeScript-native |
| LLM SDK | **Anthropic TypeScript SDK** (`@anthropic-ai/sdk`) | Direct, no abstraction overhead for POC |
| Script caching | **File-based (SHA-256 keyed)** | Simple, portable, debuggable, CI-friendly |
| Reporting | **Playwright HTML Reporter** | Free, built-in, rich — generated scripts are standard Playwright tests |
| Package management | **pnpm** | Fast, disk efficient, good monorepo support for future |
| Runtime | **Node.js 22+** | LTS, native TypeScript support via `--experimental-strip-types` or tsx |

---

## 3. Architecture

### 3.1 Full Component Map

```
┌─────────────────────────────────────────────────────────────────┐
│  ENTRY LAYER                                                    │
│  ┌──────────────┐  ┌──────────────┐  ┌────────────────────┐    │
│  │  roles.ts    │  │  steps.ts    │  │  target URL        │    │
│  └──────┬───────┘  └──────┬───────┘  └────────┬───────────┘    │
└─────────┼─────────────────┼───────────────────┼────────────────┘
          │                 │                   │
          └─────────────────┴───────────────────┘
                            │
                    ┌───────▼────────┐
                    │  Config Loader │  parse + validate + type-check
                    └───────┬────────┘
                            │
                            │  PipelineState initialized
                            ▼
┌───────────────────────────────────────────────────────────────────┐
│  LANGGRAPH PIPELINE (StateGraph)                                  │
│                                                                   │
│  ┌──────────┐    ┌───────────┐    ┌───────────┐                  │
│  │  Auth    │───▶│ Discovery │───▶│ Generator │                  │
│  │  Node    │    │  Node     │    │  Node     │                  │
│  └──────────┘    └───────────┘    └─────┬─────┘                  │
│  (login as role) (a11y tree +           │ cached .spec.ts         │
│                  element lib)           │                         │
│                                    ┌────▼──────┐                 │
│                                    │ Executor  │                 │
│                                    │  Node     │                 │
│                                    └────┬──────┘                 │
│                            ┌───────────┤                         │
│                       pass │           │ fail                    │
│                     ┌──────▼───┐  ┌────▼──────┐                 │
│                     │ Reporter │  │  Healer   │                 │
│                     │  Node    │  │  Node     │                 │
│                     └──────────┘  └────┬──────┘                 │
│                                        │ re-generate             │
│                                        └──────▶ Executor Node    │
│                                        (max 1 attempt)           │
└───────────────────────────────────────────────────────────────────┘
                            │
┌───────────────────────────▼───────────────────────────────────────┐
│  OUTPUT LAYER                                                     │
│  ┌──────────────────┐  ┌──────────────────┐  ┌────────────────┐  │
│  │ HTML Report      │  │ Element Library  │  │ Cached Scripts │  │
│  │ (Playwright)     │  │ (.ata/libs/*.json│  │ (.ata/scripts/ │  │
│  │ reports/*/       │  │ )                │  │ *.spec.ts)     │  │
│  └──────────────────┘  └──────────────────┘  └────────────────┘  │
└───────────────────────────────────────────────────────────────────┘
```

### 3.2 LangGraph State Definition

The pipeline carries a single typed state object across all nodes. This is the contract between every component.

```typescript
// src/pipeline/state.ts

import { Annotation } from '@langchain/langgraph';

export const PipelineStateAnnotation = Annotation.Root({
  // ── Input ──────────────────────────────────────────────────────
  url:        Annotation<string>,
  role:       Annotation<Role>,
  steps:      Annotation<TestStep[]>,

  // ── Discovery ──────────────────────────────────────────────────
  elementLibrary:     Annotation<ElementLibrary | null>,
  elementLibraryHash: Annotation<string | null>,

  // ── Generation ─────────────────────────────────────────────────
  scriptPath:  Annotation<string | null>,
  scriptHash:  Annotation<string | null>,
  cacheHit:    Annotation<boolean>,

  // ── Execution ──────────────────────────────────────────────────
  executionResult: Annotation<ExecutionResult | null>,
  failedStepIds:   Annotation<number[]>,

  // ── Control flow ───────────────────────────────────────────────
  healAttempt: Annotation<number>,   // max 1 per run
  status:      Annotation<'running' | 'passed' | 'failed' | 'healed' | 'error'>,

  // ── Diagnostics ────────────────────────────────────────────────
  errors:    Annotation<string[]>,
  warnings:  Annotation<string[]>,
});

export type PipelineState = typeof PipelineStateAnnotation.State;
```

### 3.3 LangGraph Graph Definition

```typescript
// src/pipeline/graph.ts

import { StateGraph } from '@langchain/langgraph';
import { PipelineStateAnnotation } from './state';
import { authNode }      from './nodes/auth';
import { discoverNode }  from './nodes/discover';
import { generateNode }  from './nodes/generate';
import { executeNode }   from './nodes/execute';
import { healNode }      from './nodes/heal';
import { reportNode }    from './nodes/report';

const shouldHeal = (state: PipelineState): 'heal' | 'report' =>
  state.executionResult?.status === 'failed' && state.healAttempt === 0
    ? 'heal'
    : 'report';

export const pipeline = new StateGraph(PipelineStateAnnotation)
  .addNode('auth',     authNode)
  .addNode('discover', discoverNode)
  .addNode('generate', generateNode)
  .addNode('execute',  executeNode)
  .addNode('heal',     healNode)
  .addNode('report',   reportNode)
  .addEdge('__start__', 'auth')
  .addEdge('auth',      'discover')
  .addEdge('discover',  'generate')
  .addEdge('generate',  'execute')
  .addConditionalEdges('execute', shouldHeal, { heal: 'heal', report: 'report' })
  .addEdge('heal',      'execute')
  .addEdge('report',   '__end__')
  .compile();
```

---

## 4. Component Specifications

### 4.1 Config Layer

#### `src/config/types.ts`

```typescript
export interface Role {
  name: string;
  credentials: {
    email: string;
    password: string;
  };
  attributes: Record<string, string | boolean | number>;
  loginUrl?: string;           // defaults to target URL if omitted
  authStrategy?: 'form' | 'storageState';
  storageStatePath?: string;   // for storageState strategy
}

export interface TestStep {
  index: number;
  prompt: string;              // raw natural language from user
  type: 'action' | 'assertion' | 'navigation' | 'unknown';  // inferred
}

export interface TestSuite {
  name: string;
  url: string;
  roles: string[];             // role names from roles.ts
  steps: string[];             // raw natural language prompts
}
```

#### `src/config/helpers.ts`

```typescript
export function defineRoles(roles: Role[]): Role[] {
  // validate required fields, throw with clear messages
  return roles;
}

export function defineTests(suites: Omit<TestSuite, never>[]): TestSuite[] {
  return suites;
}
```

#### User-authored `roles.ts` (project root)

```typescript
import { defineRoles } from './src/config/helpers';

export default defineRoles([
  {
    name: 'admin',
    credentials: {
      email: process.env.ADMIN_EMAIL!,
      password: process.env.ADMIN_PASSWORD!,
    },
    attributes: {
      hasAdminPanel: true,
      canDeleteUsers: true,
      plan: 'enterprise',
    },
  },
  {
    name: 'viewer',
    credentials: {
      email: process.env.VIEWER_EMAIL!,
      password: process.env.VIEWER_PASSWORD!,
    },
    attributes: {
      hasAdminPanel: false,
      canDeleteUsers: false,
      plan: 'free',
    },
  },
]);
```

Credentials come from environment variables — never hardcoded. The `.env` file is gitignored.

#### User-authored `steps.ts` (project root)

```typescript
import { defineTests } from './src/config/helpers';

export default defineTests([
  {
    name: 'Login and dashboard access',
    url: 'https://app.example.com',
    roles: ['admin', 'viewer'],
    steps: [
      'Navigate to the login page',
      'Enter credentials for the current role and submit the login form',
      'Verify the dashboard heading is visible after login',
      'Verify the admin panel link is visible for admin role and hidden for viewer role',
      'Verify the user menu shows the correct user name',
    ],
  },
]);
```

---

### 4.2 Browser Controller

**`src/browser/controller.ts`**

Thin, stateful wrapper over Playwright. One browser instance per pipeline run.

```typescript
export class BrowserController {
  private browser: Browser | null = null;
  private context: BrowserContext | null = null;
  private page: Page | null = null;

  async launch(options?: LaunchOptions): Promise<void>
  async navigate(url: string): Promise<void>
  async captureAccessibilityTree(): Promise<RawAccessibilityNode[]>
  async captureScreenshot(locator?: string): Promise<Buffer>
  async close(): Promise<void>
  getPage(): Page
}
```

`captureAccessibilityTree()` implementation:
1. Call `page.accessibility.snapshot({ interestingOnly: false })` — full tree
2. Call `page.evaluate()` to extract bounding boxes for all interactive elements (enrichment data for visual fallback)
3. Recursively flatten the nested snapshot into a normalized array
4. Filter: remove role `'none'`, role `'presentation'`, `hidden: true` nodes
5. Return `RawAccessibilityNode[]`

```typescript
export interface RawAccessibilityNode {
  role: string;
  name?: string;
  description?: string;
  value?: string;
  checked?: boolean;
  expanded?: boolean;
  level?: number;
  required?: boolean;
  focused?: boolean;
  boundingBox?: { x: number; y: number; width: number; height: number };
  children?: RawAccessibilityNode[];
  // Added during normalization:
  path: string;          // breadcrumb: "main > form > button"
  depth: number;
  requiresVisualFallback: boolean;
}
```

---

### 4.3 Element Library

The Element Library is a structured, auto-generated, cacheable JSON artifact. It is the "knowledge" the generator uses.

**Storage path:** `.ata/element-libraries/{url-hash}/{role-name}.json`

#### `src/elements/types.ts`

```typescript
export interface ElementLibrary {
  url: string;
  urlHash: string;
  role: string;
  capturedAt: string;          // ISO 8601
  playwrightVersion: string;
  hash: string;                // SHA-256 of elements array (for change detection)
  elements: ElementEntry[];
}

export interface ElementEntry {
  id: string;                  // SHA-256 of (role + name + path) — stable across runs
  role: string;                // ARIA role: button, textbox, link, heading, etc.
  name: string;                // accessible name (from aria-label, aria-labelledby, text content)
  description: string;         // human-readable purpose: "Submit button for login form"
  locator: string;             // Playwright locator expression (string form)
  locatorType: 'getByRole' | 'getByLabel' | 'getByText' | 'getByPlaceholder' | 'visual';
  pageSection: string;         // inferred section: "login form", "top navigation", "main content"
  visualFallback: boolean;     // true if resolved via screenshot + LLM
  boundingBox?: { x: number; y: number; width: number; height: number };
}
```

#### `src/elements/builder.ts` — Locator derivation logic

Priority order for locator derivation (matches Playwright best practices):

```
1. Has role + accessible name          → getByRole('button', { name: 'Sign in' })
2. Has associated label (form inputs)  → getByLabel('Email address')
3. Has placeholder text                → getByPlaceholder('Enter your email')
4. Has visible text (links, buttons)   → getByText('Forgot password?')
5. None of the above                   → requiresVisualFallback = true
```

#### Visual Fallback (for `requiresVisualFallback: true` elements)

- Take a full-page screenshot
- Crop to element bounding box (± 20px padding)
- Send to Claude Haiku with prompt:
  ```
  This is a screenshot of a UI element at position {x},{y}.
  What is this element? What is its purpose? Describe it in one sentence
  suitable for a test automation engineer to identify it.
  Output only the description, nothing else.
  ```
- Use the returned description as the element's `description` field
- Set `locatorType: 'visual'`
- For visual elements, the locator falls back to a coordinate-based click:
  `page.mouse.click({x}, {y})` — flagged as unstable in the element library

#### Element Library Diff (`src/elements/diff.ts`)

```typescript
export interface ElementDiff {
  added: ElementEntry[];
  removed: ElementEntry[];
  changed: ElementEntry[];    // same id, different name/role/locator
  unchanged: ElementEntry[];
}

export function diffLibraries(
  old: ElementLibrary,
  next: ElementLibrary
): ElementDiff
```

Used by the Healer node to determine which failed steps need re-generation.

---

### 4.4 Discovery Node

**`src/pipeline/nodes/discover.ts`**

```typescript
export async function discoverNode(state: PipelineState): Promise<Partial<PipelineState>> {
  const browser = new BrowserController();
  await browser.launch({ headless: true });
  await browser.navigate(state.url);

  // 1. Capture raw accessibility tree
  const rawTree = await browser.captureAccessibilityTree();

  // 2. Build element library
  const builder = new ElementLibraryBuilder(browser);
  const library = await builder.build(rawTree, state.url, state.role.name);

  // 3. Enrich visual fallback elements via Haiku
  const enriched = await enrichVisualFallbacks(library, browser);

  // 4. Cache the library
  const cached = await elementLibraryCache.save(enriched);

  await browser.close();

  return {
    elementLibrary: enriched,
    elementLibraryHash: enriched.hash,
  };
}
```

---

### 4.5 Auth Node

**`src/pipeline/nodes/auth.ts`**

Handles login before discovery. The LLM is not involved in auth — it is purely deterministic code.

**Strategy 1 — ARIA-based form detection (default):**
1. Navigate to `role.loginUrl` (or target URL if not specified)
2. Detect login form via accessibility tree:
   - Find `textbox` with name matching `/email|username|login/i`
   - Find `textbox` with name matching `/password/i`
   - Find `button` or `[type=submit]`
3. Fill email, fill password, click submit
4. Wait for navigation or URL change
5. Validate: check current URL is not still the login page

**Strategy 2 — Storage state (for complex auth):**
- If `role.authStrategy === 'storageState'`, call `context.storageState()` restore from `role.storageStatePath`
- Skip form login entirely

**Out of scope for POC:** MFA, OAuth/SSO, CAPTCHA, magic links.

---

### 4.6 Script Generator Node

**`src/pipeline/nodes/generate.ts`**

#### Cache check

```typescript
const cacheKey = sha256(`${state.url}::${state.role.name}::${state.steps.map(s => s.prompt).join('|')}`);
const cached = await scriptCache.get(cacheKey);
if (cached && cached.lastRunStatus === 'passed') {
  return { scriptPath: cached.path, scriptHash: cacheKey, cacheHit: true };
}
```

#### Step-by-step generation

For each step, call Claude Sonnet 4.6 with this prompt structure:

```
SYSTEM:
You are a Playwright TypeScript test code generator.
You generate individual test steps — not full test files.
Output ONLY raw TypeScript code. No markdown fences. No explanation. No imports.
Use only Playwright's page object. Assume `page` and `expect` are in scope.

USER:
## Target URL
{url}

## Current User Role
Name: {role.name}
Attributes: {JSON.stringify(role.attributes, null, 2)}

## Page Elements Available
{elements.map(e =>
  `[${e.id}] ${e.description}\n  Locator: ${e.locator}`
).join('\n\n')}

## Previous Steps Generated (for context)
{previousGeneratedSteps.join('\n')}

## Step to Implement (step {index} of {total})
"{step.prompt}"

## Rules
- Use ONLY locators from the Page Elements list above, referenced by their locator expression
- If this step implies verification/assertion, include an expect() assertion
- For role-conditional assertions, use role attributes:
  if (role.attributes.{attr}) { ... } else { ... }
- Include appropriate await keywords
- Add waits for navigation: await page.waitForURL() or await expect(page).toHaveURL()
- Do not navigate unless the step explicitly says to
- If you cannot map the step to any element in the list, output a comment:
  // UNMAPPED: {reason}
```

#### Script assembly (`src/generator/assembler.ts`)

Wraps all generated steps into a complete `.spec.ts` file:

```typescript
import { test, expect } from '@playwright/test';

// Role definition — injected at generation time, not imported at runtime
const role = {
  name: '{role.name}',
  credentials: { email: '{role.credentials.email}', password: '{role.credentials.password}' },
  attributes: {role.attributes as JSON},
};

test.describe('{suite.name} [{role.name}]', () => {
  test('{step.prompt}', async ({ page }) => {
    {generatedCode}
  });

  // ... one test() block per step
});
```

Each step becomes an individual `test()` block so that Playwright reports pass/fail at step granularity.

#### TypeScript validation (`src/generator/validator.ts`)

1. Write the assembled script to a temp file
2. Run `tsc --noEmit --strict temp-file.ts`
3. If errors: send error message back to Claude Sonnet with:
   ```
   The following TypeScript code has a compile error. Fix it.
   
   Code:
   {code}
   
   Error:
   {tscError}
   
   Output only the corrected code, no explanation.
   ```
4. Maximum one retry per step
5. If still failing after retry: write the step as a skipped test with a `test.skip()` and a comment explaining the error

#### Script caching (`src/generator/cache.ts`)

```typescript
interface CacheIndex {
  [hash: string]: {
    path: string;           // relative path to .spec.ts
    createdAt: string;
    lastRunAt: string | null;
    lastRunStatus: 'passed' | 'failed' | null;
    url: string;
    role: string;
    stepCount: number;
  };
}
```

Cache index stored at `.ata/scripts/index.json`.
Generated scripts stored at `.ata/scripts/{hash}.spec.ts`.

---

### 4.7 Executor Node

**`src/pipeline/nodes/execute.ts`**

1. Generate a minimal `playwright.config.ts` pointing to the cached script
2. Run: `npx playwright test {scriptPath} --reporter=json,html`
3. Parse the JSON output (`test-results/results.json`)
4. Map test results back to step indices
5. Capture screenshots for failed steps (Playwright does this automatically with `screenshot: 'only-on-failure'`)

```typescript
export interface ExecutionResult {
  status: 'passed' | 'failed' | 'partial';
  totalSteps: number;
  passedSteps: number;
  failedSteps: number;
  skippedSteps: number;
  duration: number;           // milliseconds
  steps: StepResult[];
  reportPath: string;
}

export interface StepResult {
  index: number;
  prompt: string;
  status: 'passed' | 'failed' | 'skipped';
  error?: string;
  screenshotPath?: string;
  duration: number;
}
```

---

### 4.8 Self-Healer Node

**`src/pipeline/nodes/heal.ts`**

Triggered only when: `executionResult.status === 'failed'` AND `healAttempt === 0`.

```typescript
export async function healNode(state: PipelineState): Promise<Partial<PipelineState>> {
  // 1. Re-run discovery with fresh browser session
  const freshLibrary = await rediscover(state.url, state.role);

  // 2. Diff old vs new element library
  const diff = diffLibraries(state.elementLibrary!, freshLibrary);

  // 3. Identify which failed steps reference changed/removed elements
  const stepsToRegenerate = state.failedStepIds.filter(stepId => {
    const step = state.steps[stepId];
    return isStepAffectedByDiff(step, diff, state.elementLibrary!);
  });

  if (stepsToRegenerate.length === 0) {
    // No elements changed — this is a genuine app failure, not drift
    return {
      healAttempt: 1,
      warnings: [...state.warnings, 'Heal skipped: no element changes detected. Likely a genuine failure.'],
    };
  }

  // 4. Regenerate only affected steps with fresh element library
  const repairedScript = await regenerateAffectedSteps(
    state.scriptPath!,
    stepsToRegenerate,
    freshLibrary,
    state.steps,
    state.role,
  );

  // 5. Update cache with repaired script
  await scriptCache.update(state.scriptHash!, repairedScript);

  return {
    elementLibrary: freshLibrary,
    elementLibraryHash: freshLibrary.hash,
    scriptPath: repairedScript.path,
    healAttempt: 1,
    status: 'running',
  };
}
```

**Heal vs. genuine failure distinction:**
- Elements changed in diff AND failed steps reference those elements → heal (regenerate)
- Elements unchanged AND steps failed → genuine failure (skip regeneration, report immediately)
- Mixed: regenerate affected steps only, keep passing steps' code intact

---

### 4.9 Reporter Node

**`src/pipeline/nodes/report.ts`**

1. Read `ExecutionResult` from state
2. Generate JSON summary at `reports/{timestamp}/summary.json`
3. Playwright's HTML reporter generates `reports/{timestamp}/index.html` automatically
4. Print console summary

```typescript
interface RunSummary {
  runId: string;              // timestamp-based
  suite: string;
  url: string;
  role: string;
  status: 'passed' | 'failed' | 'healed';
  cacheHit: boolean;
  healAttempted: boolean;
  healSucceeded: boolean;
  totalSteps: number;
  passedSteps: number;
  failedSteps: number;
  duration: number;
  reportPath: string;
  steps: StepResult[];
}
```

---

## 5. LLM Prompt Design

### 5.1 Element Description Enrichment (Claude Haiku)

Used to generate human-readable descriptions for element library entries and visual fallback resolution.

```
Given this accessibility tree node:
- Role: {role}
- Name: {name || 'none'}
- Path in page: {path}
- Nearby text context: {contextText}

Write a single sentence describing what this UI element does and where it appears on the page.
Keep it under 20 words. Be specific. Example: "Submit button at the bottom of the login form."
Output only the sentence, nothing else.
```

### 5.2 Step Generation (Claude Sonnet 4.6)

Full prompt structure documented in section 4.6 above.

### 5.3 TypeScript Fix (Claude Sonnet 4.6)

```
Fix the TypeScript compile error in this Playwright test step.

Original step description: "{step.prompt}"

Code with error:
{code}

Compiler error:
{error}

Rules:
- Fix only the compile error
- Do not change the test logic
- Output only the corrected code, no explanation, no markdown
```

---

## 6. File & Directory Structure

```
ai-test-automation/
│
├── src/
│   ├── config/
│   │   ├── types.ts               # Role, TestSuite, TestStep, ElementLibrary interfaces
│   │   ├── helpers.ts             # defineRoles(), defineTests()
│   │   └── loader.ts              # Load + validate roles.ts and steps.ts at runtime
│   │
│   ├── browser/
│   │   ├── controller.ts          # Playwright launch/navigate/close/snapshot
│   │   ├── accessibility.ts       # captureAccessibilityTree(), normalize(), filter()
│   │   └── auth.ts                # Form-based login detection and execution
│   │
│   ├── elements/
│   │   ├── types.ts               # ElementLibrary, ElementEntry interfaces
│   │   ├── builder.ts             # RawAccessibilityNode[] → ElementLibrary
│   │   ├── locator.ts             # Locator derivation logic (priority order)
│   │   ├── enricher.ts            # Visual fallback enrichment via Claude Haiku
│   │   ├── cache.ts               # Read/write element libraries to .ata/
│   │   └── diff.ts                # Diff two ElementLibrary instances
│   │
│   ├── llm/
│   │   ├── client.ts              # Anthropic SDK wrapper, model selection, retry logic
│   │   └── prompts.ts             # All prompt templates as typed functions
│   │
│   ├── generator/
│   │   ├── stepGenerator.ts       # Single step: prompt + element library → TS code
│   │   ├── assembler.ts           # Steps → complete .spec.ts file
│   │   ├── validator.ts           # tsc --noEmit check + LLM fix retry
│   │   └── cache.ts               # Script cache: hash → .spec.ts path + metadata
│   │
│   ├── pipeline/
│   │   ├── state.ts               # PipelineState type (LangGraph Annotation)
│   │   ├── graph.ts               # StateGraph definition, edges, conditional routing
│   │   └── nodes/
│   │       ├── auth.ts            # Auth node
│   │       ├── discover.ts        # Discovery node
│   │       ├── generate.ts        # Generator node
│   │       ├── execute.ts         # Executor node
│   │       ├── heal.ts            # Self-healer node
│   │       └── report.ts          # Reporter node
│   │
│   ├── reporter/
│   │   └── aggregator.ts          # Build RunSummary, write JSON, print console output
│   │
│   └── index.ts                   # CLI entry point: parse args, load config, run pipeline
│
├── examples/
│   ├── roles.ts                   # Example roles file
│   └── steps.ts                   # Example test suites
│
├── .ata/                          # Runtime artifacts — GITIGNORED
│   ├── element-libraries/
│   │   └── {url-hash}/
│   │       └── {role-name}.json
│   └── scripts/
│       ├── index.json             # Cache index
│       └── {hash}.spec.ts         # Cached generated test files
│
├── reports/                       # Test reports — GITIGNORED
│   └── {timestamp}/
│       ├── summary.json
│       └── index.html             # Playwright HTML report
│
├── .env                           # Credentials — GITIGNORED
├── .env.example                   # Template — committed
├── .gitignore
├── playwright.config.ts           # Playwright base config
├── tsconfig.json
├── package.json
└── README.md
```

---

## 7. CLI Interface

**Entry point:** `src/index.ts`

```bash
# Run all test suites for all roles
npx ata run --config steps.ts --roles roles.ts

# Run a specific suite
npx ata run --suite "Login and dashboard access"

# Run for a specific role only
npx ata run --role admin

# Force regeneration (ignore cache)
npx ata run --no-cache

# Discovery only (build element library, no tests)
npx ata discover --url https://app.example.com --role admin

# Show cached element library
npx ata library show --url https://app.example.com --role admin

# Show cached scripts
npx ata cache list
npx ata cache clear
```

---

## 8. Key Design Decisions with Rationale

### TypeScript throughout, not Python
The roles/steps config files are `.ts` — they benefit from type checking and IDE autocomplete. The generated scripts are `.ts`. The Playwright runner is TypeScript-native. Mixing languages would break the consistency that makes the pipeline debuggable end-to-end.

### LangGraph.js for orchestration, not a custom pipeline
The pipeline has conditional branching (heal or not), state that evolves across nodes, and may later need multi-agent parallelism (run multiple roles concurrently). LangGraph's StateGraph is the exact right abstraction. A custom pipeline with if/else would become unmaintainable as soon as healing and multi-role runs are added. LangGraph also provides built-in observability via LangSmith.

### Generate-once + cache, not regenerate every run
Non-determinism is the #1 cause of AI test tool failure in production (confirmed by research). The prompt is the canonical definition. The script is a versioned, diffable artifact. CI pipelines get deterministic runs. Self-healing regenerates only when needed — not on every run.

### Accessibility tree as primary element strategy, not visual
Playwright MCP production data: accessibility tree snapshots are 2–5KB of structured text vs. multi-MB screenshots. 10–100x faster, 10–100x cheaper per LLM call, more reliable for element targeting. Visual is reserved for the subset of elements the tree cannot describe.

### One heal attempt per run, not unlimited
Unlimited healing would mask genuine failures and inflate LLM costs. One attempt distinguishes between "UI changed" (heals) and "feature broke" (doesn't heal). The distinction is the entire value of a test suite.

### tsc validation of generated scripts
The LLM generates TypeScript. TypeScript errors are caught immediately, not at runtime. One retry loop with the compile error fed back to the LLM fixes the vast majority of syntax issues. This is cheap insurance against the most common generation failure mode.

### Each step is a separate `test()` block
Playwright reports pass/fail at the test granularity. By making each step a `test()`, the reporter shows exactly which step failed, with its own screenshot and error message. A single `test()` for all steps would only report the first failure and obscure the rest.

### Credentials from environment variables
Never hardcoded in `roles.ts`. The `roles.ts` file is committed; credentials are not. `.env` is gitignored. This is the minimum viable security posture for a self-hosted tool.

---

## 9. POC Success Criteria

| Metric | Target | How Measured |
|---|---|---|
| Element resolution accuracy (well-built SPA) | ≥ 80% of steps map to correct element | Manual review of generated locators |
| End-to-end pipeline runs without human input | Yes | Run on 3 apps without intervention |
| Generated script passes tsc compile | ≥ 95% (with one LLM retry) | tsc exit code tracking |
| Self-healer resolves selector drift | ≥ 70% of drift-caused failures | Introduce deliberate UI change, measure heal rate |
| Full run time (10-step suite) | < 3 minutes | Wall clock |
| LLM cost per full run | < $0.10 per suite per role | Anthropic usage dashboard |
| Assertion correctness | ≥ 60% match human intent | Manual review against prompt intent |

---

## 10. Out of Scope for POC

- MFA, OAuth/SSO, CAPTCHA authentication
- File upload/download interactions
- Drag-and-drop, canvas drawing
- Multi-tab / multi-window flows
- API-level testing (HTTP requests)
- Parallel multi-role execution (sequential only in POC)
- CI/CD pipeline integration
- Test data management / database seeding
- Cross-browser testing (Chromium only in POC)
- Mobile/responsive testing
