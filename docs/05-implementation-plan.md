# AI Test Automation — POC Implementation Plan

---

## Overview

Three phases, each with a clear goal and exit condition.

| Phase | Goal | Exit Condition |
|---|---|---|
| Phase 1 — Foundation | Pipeline runs end-to-end on one happy path | A 5-step test suite runs on a real app without errors |
| Phase 2 — Robustness | Caching, self-healing, roles, visual fallback | Pipeline recovers from UI change without human intervention |
| Phase 3 — Validation | Measure, benchmark, identify limits | Success criteria table in design spec is populated with real data |

---

## Phase 1 — Foundation

### Goal
Get the pipeline running end-to-end on a single happy path:
- One URL, one role, one test suite, no caching, no healing
- Accessibility tree → element library → LLM script → Playwright execution → console output

---

### Task 1.1 — Project Scaffold

**Deliverable:** Clean TypeScript project, all dependencies installed, `src/index.ts` runs without error.

**Steps:**
```bash
mkdir -p src/{config,browser,elements,llm,generator,pipeline/nodes,reporter}
pnpm init
pnpm add @playwright/test @anthropic-ai/sdk @langchain/langgraph
pnpm add -D typescript tsx @types/node
npx playwright install chromium
```

**`tsconfig.json`** — strict mode, path aliases:
```json
{
  "compilerOptions": {
    "target": "ES2022",
    "module": "NodeNext",
    "moduleResolution": "NodeNext",
    "strict": true,
    "outDir": "dist",
    "rootDir": "src",
    "paths": {
      "@ata/*": ["./src/*"]
    }
  }
}
```

**`package.json` scripts:**
```json
{
  "scripts": {
    "dev": "tsx src/index.ts",
    "build": "tsc",
    "typecheck": "tsc --noEmit"
  }
}
```

**`.env.example`:**
```
ANTHROPIC_API_KEY=your_key_here
ADMIN_EMAIL=
ADMIN_PASSWORD=
VIEWER_EMAIL=
VIEWER_PASSWORD=
```

---

### Task 1.2 — Config Types and Helpers

**Deliverable:** `defineRoles()` and `defineTests()` work, runtime validation throws clear errors.

**Files:**
- `src/config/types.ts` — all interfaces
- `src/config/helpers.ts` — `defineRoles()`, `defineTests()`
- `src/config/loader.ts` — dynamic import of user's `roles.ts` and `steps.ts`

**Validation rules for `defineRoles`:**
- `name` is required and unique
- `credentials.email` and `credentials.password` are non-empty strings
- Warn if credentials look like placeholders (`'your_email_here'`)

**Validation rules for `defineTests`:**
- `name` is required
- `url` is a valid URL
- `roles` references names that exist in the loaded roles
- `steps` is a non-empty array of non-empty strings

---

### Task 1.3 — Browser Controller

**Deliverable:** `BrowserController` can launch Chromium, navigate to a URL, and return the raw accessibility tree as a flat array.

**Files:** `src/browser/controller.ts`, `src/browser/accessibility.ts`

**Key implementation notes:**
- Use `{ headless: true }` for CI compatibility; add `{ headless: false }` flag for debugging
- `page.accessibility.snapshot({ interestingOnly: false })` returns a nested object — write a recursive flatten function
- Filter criteria for "interesting" nodes:
  ```typescript
  const SKIP_ROLES = new Set(['none', 'presentation', 'generic', 'group']);
  const isInteresting = (node: RawNode) =>
    !SKIP_ROLES.has(node.role) &&
    node.role !== 'ignored' &&
    !node.hidden;
  ```
- Attach `path` breadcrumb during flatten: walk up through parent roles to build a context string like `"navigation > list > listitem > link"`

---

### Task 1.4 — Element Library Builder

**Deliverable:** `ElementLibraryBuilder.build()` takes the flat ARIA node array and returns a typed `ElementLibrary` with a locator for every element it can resolve.

**Files:** `src/elements/builder.ts`, `src/elements/locator.ts`, `src/elements/types.ts`

**Locator derivation (`src/elements/locator.ts`):**

```typescript
export function deriveLocator(node: RawAccessibilityNode): {
  locator: string;
  locatorType: ElementEntry['locatorType'];
  requiresVisualFallback: boolean;
} {
  // Priority 1: role + name (most robust)
  if (node.role && node.name) {
    return {
      locator: `page.getByRole('${node.role}', { name: ${JSON.stringify(node.name)} })`,
      locatorType: 'getByRole',
      requiresVisualFallback: false,
    };
  }
  // Priority 2: label (form inputs)
  if (['textbox', 'combobox', 'checkbox', 'radio', 'spinbutton'].includes(node.role) && node.name) {
    return {
      locator: `page.getByLabel(${JSON.stringify(node.name)})`,
      locatorType: 'getByLabel',
      requiresVisualFallback: false,
    };
  }
  // Priority 3: placeholder
  if (node.placeholder) {
    return {
      locator: `page.getByPlaceholder(${JSON.stringify(node.placeholder)})`,
      locatorType: 'getByPlaceholder',
      requiresVisualFallback: false,
    };
  }
  // Priority 4: visible text
  if (node.name && node.name.length < 80) {
    return {
      locator: `page.getByText(${JSON.stringify(node.name)}, { exact: true })`,
      locatorType: 'getByText',
      requiresVisualFallback: false,
    };
  }
  // Fallback: needs visual resolution
  return {
    locator: '',
    locatorType: 'visual',
    requiresVisualFallback: true,
  };
}
```

**Element ID generation:**
```typescript
const id = sha256(`${node.role}::${node.name ?? ''}::${node.path}`).slice(0, 16);
```

---

### Task 1.5 — LLM Client

**Deliverable:** Typed wrapper around the Anthropic SDK. Callers never interact with the SDK directly.

**Files:** `src/llm/client.ts`, `src/llm/prompts.ts`

```typescript
// src/llm/client.ts

export class LLMClient {
  private sonnet = 'claude-sonnet-4-6';
  private haiku  = 'claude-haiku-4-5-20251001';

  async generateCode(prompt: string): Promise<string>    // uses Sonnet
  async enrich(prompt: string): Promise<string>          // uses Haiku
  async fixCode(prompt: string): Promise<string>         // uses Sonnet
}
```

All prompt templates live in `src/llm/prompts.ts` as typed functions:

```typescript
export const prompts = {
  enrichElement: (node: RawAccessibilityNode, context: string) => `...`,
  generateStep:  (step: TestStep, elements: ElementEntry[], role: Role, previous: string[]) => `...`,
  fixTypeScript: (code: string, error: string, stepPrompt: string) => `...`,
};
```

---

### Task 1.6 — Step Generator + Assembler + Validator

**Deliverable:** Takes a full test suite + element library, returns a path to a valid `.spec.ts` file.

**Files:** `src/generator/stepGenerator.ts`, `src/generator/assembler.ts`, `src/generator/validator.ts`

**`stepGenerator.ts`:** calls `LLMClient.generateCode()` for each step, accumulates previous steps for context

**`assembler.ts`:** wraps steps in test structure:
```typescript
const fileContent = `
import { test, expect } from '@playwright/test';

const role = ${JSON.stringify(role, null, 2)} as const;

test.describe('${suite.name} [${role.name}]', () => {
  test.use({ baseURL: '${url}' });

  ${steps.map((step, i) => `
  test(${JSON.stringify(step.prompt)}, async ({ page }) => {
    ${generatedCode[i]}
  });`).join('\n')}
});
`.trim();
```

**`validator.ts`:**
```typescript
async function validate(filePath: string): Promise<{ valid: boolean; error?: string }> {
  const result = await execa('tsc', ['--noEmit', '--strict', filePath]);
  return { valid: result.exitCode === 0, error: result.stderr };
}
```

Write temp file to `.ata/scripts/.tmp/`, validate, then move to final path on success.

---

### Task 1.7 — LangGraph Pipeline (Phase 1 — linear only)

**Deliverable:** Auth → Discover → Generate → Execute → Report runs in sequence.

**Files:** `src/pipeline/state.ts`, `src/pipeline/graph.ts`, all node files

Phase 1 nodes are stubs for heal and conditional routing — implement them fully in Phase 2.

---

### Task 1.8 — Executor Node

**Deliverable:** Runs the generated `.spec.ts` file via `playwright test`, returns structured results.

**Files:** `src/pipeline/nodes/execute.ts`

```typescript
const result = await execa('npx', [
  'playwright', 'test',
  scriptPath,
  '--reporter=json',
  '--output', `reports/${runId}`,
], { reject: false });

const jsonReport = JSON.parse(readFileSync('test-results.json', 'utf8'));
```

Map Playwright's JSON output format to `ExecutionResult`. Key fields:
- `suite.specs[].tests[].results[].status` → `'passed' | 'failed' | 'timedOut' | 'skipped'`
- `suite.specs[].tests[].results[].error.message` → error string
- `suite.specs[].tests[].results[].attachments` → screenshot paths

---

### Task 1.9 — Basic Reporter

**Deliverable:** Console summary after every run. HTML report available at `reports/{timestamp}/index.html`.

```
─────────────────────────────────────────────
  ATA Run Summary
  Suite:  Login and dashboard access
  Role:   admin
  URL:    https://app.example.com
─────────────────────────────────────────────
  ✓ Navigate to the login page              (0.8s)
  ✓ Enter credentials and submit            (1.2s)
  ✓ Verify dashboard heading is visible     (0.5s)
  ✗ Verify admin panel link visibility      (2.1s)
    Error: Expected element to be visible
    Screenshot: reports/2026-04-14/step-4.png
─────────────────────────────────────────────
  Result: FAILED  (3 passed, 1 failed)
  Duration: 4.6s
  HTML Report: reports/2026-04-14/index.html
─────────────────────────────────────────────
```

---

### Task 1.10 — End-to-End Smoke Test

**Deliverable:** Run the complete pipeline on a public demo app.

**Suggested test targets:**
- `https://demo.playwright.dev/todomvc` — simple, well-built, good ARIA
- `https://the-internet.herokuapp.com` — various UI patterns
- Any publicly accessible app with login

Manually review the generated element library and scripts. Note any unmapped elements.

---

## Phase 2 — Robustness

### Task 2.1 — Script Cache

**Deliverable:** On second run with no changes, cache is hit and no LLM calls are made.

- `src/generator/cache.ts` — full read/write/invalidate implementation
- Add `--no-cache` flag to CLI for forced regeneration
- Cache hit logged clearly in console: `[cache] Using cached script {hash}`
- Update `lastRunStatus` and `lastRunAt` in cache index after every execution

---

### Task 2.2 — Element Library Cache + Diff

**Deliverable:** Element libraries are persisted to disk, loaded on subsequent runs, and diffed against fresh captures.

- `src/elements/cache.ts` — full read/write implementation
- `src/elements/diff.ts` — structural diff (by element `id`)
- On discovery: load cached library first, compare hash, skip re-enrichment if unchanged

---

### Task 2.3 — Self-Healer Node

**Deliverable:** When a UI change causes test failure, the pipeline detects it and regenerates only affected steps.

- `src/pipeline/nodes/heal.ts` — full implementation
- Conditional edge in `graph.ts`: `execute → heal (if failed, healAttempt=0) → execute`
- Guard: if no elements changed in diff, skip regeneration and report genuine failure
- Test by manually renaming a button label on a local test app

---

### Task 2.4 — Auth Node (ARIA-based)

**Deliverable:** Pipeline logs in as the specified role before discovery.

- `src/browser/auth.ts` — ARIA-based form detection
- Detect email input, password input, and submit button from accessibility tree
- Fill credentials, submit, wait for URL change
- Validate logged-in state: check URL is not still login page
- Handle: post-login redirects, cookie consent banners (dismiss if detected)

---

### Task 2.5 — Role Attributes in Assertion Generation

**Deliverable:** Generated assertions correctly reference role attributes for conditional logic.

- Update step generation prompt to include role attributes more explicitly
- Add example conditional assertions to the prompt:
  ```
  Example for conditional assertion:
  Step: "Verify the delete button is visible only for admin"
  Generated:
    if (role.attributes.canDeleteUsers) {
      await expect(page.getByRole('button', { name: 'Delete' })).toBeVisible();
    } else {
      await expect(page.getByRole('button', { name: 'Delete' })).not.toBeVisible();
    }
  ```
- Test with a role that has `hasAdminPanel: false` — assert the generated code correctly uses `not.toBeVisible()`

---

### Task 2.6 — Multi-Role Runner

**Deliverable:** A single test suite runs sequentially for all roles defined in `steps.ts`.

- `src/index.ts` — outer loop over `suite.roles`
- One full pipeline run per role
- Aggregate all role results in the final report
- HTML report contains sections per role

---

### Task 2.7 — Visual Fallback Enrichment

**Deliverable:** Elements that have no accessible name get descriptions from Claude Haiku via screenshot.

- `src/elements/enricher.ts` — full implementation
- Only triggered for `requiresVisualFallback: true` elements
- Crop screenshot to element bounding box (requires bounding box from Task 1.3)
- Claude Haiku prompt → description → update element entry
- Log count of visual fallback elements: `[discovery] 3 elements required visual fallback`
- Visual elements use coordinate-based fallback locator, flagged as unstable in the library

---

## Phase 3 — Validation

### Task 3.1 — Test App 1: Modern SPA

**Target:** A well-built React/Vue/Angular app with good ARIA labels.

**Measure:**
- Element resolution accuracy: manually review each element in the library, mark correct/incorrect
- Assertion correctness: manually review each generated assertion against the step prompt intent
- False positive rate: how many tests pass but don't actually verify what was asked

---

### Task 3.2 — Test App 2: Legacy / Low-Accessibility App

**Target:** An older app with poor ARIA compliance, generic class names, no labels.

**Measure:**
- How many elements fall back to visual resolution
- Visual fallback accuracy vs. accessibility tree accuracy
- Whether the pipeline can complete at all without human intervention

---

### Task 3.3 — Test App 3: Role-Based App

**Target:** Any app with meaningful role differences (e.g., admin sees different UI than regular user).

**Measure:**
- Role attribute injection correctness
- Conditional assertion accuracy
- Whether the same prompts produce correct tests for both roles

---

### Task 3.4 — Metrics Collection

| Metric | Collection Method |
|---|---|
| Element resolution accuracy | Manual review of element library |
| Assertion correctness | Manual review: does the assertion match prompt intent? |
| tsc compile pass rate | Track in executor: `compileErrors / totalSteps` |
| Heal success rate | Track in healer: `healSucceeded / healAttempted` |
| LLM cost per run | Anthropic usage API or token counting |
| Full pipeline wall time | Process timing in `src/index.ts` |
| Cache hit rate | Track in generator: `cacheHits / totalRuns` |

---

### Task 3.5 — Failure Mode Catalog

Document every category of failure observed across all test apps.

**Template per failure:**
```
Category: [element resolution | assertion | timing | auth | unexpected state | other]
Frequency: [always | often | sometimes | rare]
Root cause: [description]
Impact: [test fails | test passes incorrectly | pipeline crashes | other]
Potential fix: [description]
Priority: [P1 | P2 | P3]
```

This catalog becomes the backlog for post-POC improvements.

---

## Dependency Map

```
1.1 Scaffold
  └─▶ 1.2 Config
        └─▶ 1.3 Browser Controller
              └─▶ 1.4 Element Library Builder
                    └─▶ 1.5 LLM Client
                          └─▶ 1.6 Step Generator
                                └─▶ 1.7 LangGraph Pipeline
                                      ├─▶ 1.8 Executor
                                      └─▶ 1.9 Reporter
                                            └─▶ 1.10 E2E Smoke Test

Phase 1 complete
  ├─▶ 2.1 Script Cache
  ├─▶ 2.2 Element Library Cache + Diff
  │     └─▶ 2.3 Self-Healer
  ├─▶ 2.4 Auth Node
  ├─▶ 2.5 Role Attributes
  ├─▶ 2.6 Multi-Role Runner (needs 2.4 + 2.5)
  └─▶ 2.7 Visual Fallback (needs 1.3 bounding boxes)

Phase 2 complete
  ├─▶ 3.1 Test App 1
  ├─▶ 3.2 Test App 2
  ├─▶ 3.3 Test App 3
  ├─▶ 3.4 Metrics Collection
  └─▶ 3.5 Failure Mode Catalog
```

---

## Environment Setup Checklist

Before starting Phase 1:

- [ ] Node.js 22+ installed
- [ ] pnpm installed (`npm install -g pnpm`)
- [ ] `ANTHROPIC_API_KEY` in `.env`
- [ ] Chromium installed (`npx playwright install chromium`)
- [ ] TypeScript 5.x (`pnpm add -D typescript`)
- [ ] `tsx` for running TypeScript directly (`pnpm add -D tsx`)
- [ ] Test app credentials available for at least one role
- [ ] `.gitignore` includes: `.env`, `.ata/`, `reports/`, `node_modules/`
