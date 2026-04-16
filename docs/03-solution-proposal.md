# AI Test Automation — Pain Points, Research & Proposed Solution

---

## Core Pain Points (Priority Order)

### 1. Element identification without coding knowledge
The #1 blocker. CSS selectors, XPath, DOM structure are invisible to non-technical users. Any solution that requires them — or requires humans to curate them — fails at the first step. This is the single biggest reason automation projects never start for non-technical teams.

### 2. Test brittleness and maintenance cost
Selector-based tests break on every UI change. This is why most automation projects stall: the cost of keeping tests alive exceeds the value they provide. Self-maintenance is not a nice-to-have — it is the product.

### 3. Intent-to-test translation gap
A BA or QA can articulate what to test in plain language. Converting that to a reliable, assertion-bearing automated test requires expertise they don't have. The gap is not in the *what* but in the *how to encode it*.

### 4. Role-based testing is a second-class citizen everywhere
Testing the same flow as admin vs. user vs. guest is either duplicated code or complex parameterization. No existing tool treats it as a first-class concept from the ground up.

### 5. Non-determinism vs. reproducibility
Non-determinism is explicitly confirmed by research as the #1 reason AI testing tools fail in production. If re-running the same test produces different paths, failures become undiagnosable and CI pipelines become unreliable.

### 6. Black-box lock-in
Most AI test tools own your tests. Output is opaque, non-portable, non-diffable. Teams can't debug, audit, or migrate. When the vendor changes pricing or shuts down, the test suite is gone.

---

## Research Findings

### Finding 1: The accessibility tree is the right element strategy — and it's proven

**Playwright MCP** (released March 2025, by Microsoft) uses the browser's built-in accessibility tree as the primary interface for LLM-driven automation. It produces 2–5KB of structured YAML per page — roles, labels, states, text — with no instrumentation, no selectors, no human input. LLMs reason about this naturally: `button "Submit Order"` is semantically clear in a way that `#btn-0x3f` is not.

**testRigor** independently validates this approach at scale: their platform resolves elements by visible text, position, and OCR (for canvas/image text) — no XPath, no CSS — and customers run thousands of tests daily with high stability.

**Playwright itself** now recommends `getByRole`, `getByLabel`, `getByText` as its own best-practice locator strategy — semantic, human-readable, and significantly more resilient than selectors. The accessibility tree is what backs these locators.

**browser-use** (open source) uses a DOM Processing Engine that:
- Coordinates multiple Chrome DevTools Protocol (CDP) calls to gather accessibility data, layout metrics, and interactive element detection
- Assigns stable backend node IDs (refs) to every interactive element
- Maps those refs to LLM-readable descriptions
- Achieves 95%+ cache hit rates and processes 500–2000 elements per page in 10–100ms

### Finding 2: Non-determinism is solved by generate-and-cache, not by regenerating every run

Research confirms the non-determinism problem is explicitly why AI testing tools fail in production. The emerging field solution: generate scripts once, cache them, log every LLM decision for replay, and only regenerate on failure. This preserves the resilience advantage while giving reproducibility. The prompt stays as the canonical definition; the script becomes a versioned artifact.

Playwright MCP's approach: every command is logged, every LLM response is recorded, and execution can be replayed exactly.

### Finding 3: Visual detection is a fallback, not a foundation

Multimodal AI can read screenshots, but it is 10–100x more expensive and slower than the accessibility tree approach, and less reliable for precise assertions. Its correct role is as a fallback for elements the accessibility tree cannot reach: canvas, SVGs, image-rendered text, poorly accessible legacy apps.

Research on VLM-based testing shows 9% higher code coverage vs. traditional methods — useful but not sufficient alone.

### Finding 4: Playwright native AI agents confirm the direction (October 2025)

Playwright shipped three native AI agents in version 1.56:
- **Planner** — navigates the app, produces a Markdown test plan
- **Generator** — converts the Markdown plan into executable Playwright TypeScript test files
- **Healer** — runs tests, diagnoses failures, generates patches (locator updates, wait adjustments)

This independently validates the exact pipeline architecture proposed here. The key difference: Playwright's agents are interactive (VS Code / Claude Code integration), not pipeline-oriented. Our system targets CI-first, autonomous, role-based execution.

### Finding 5: LangGraph.js is the right orchestration layer

LangGraph models agent workflows as stateful graphs:
- **State**: shared typed object flowing through the entire pipeline
- **Nodes**: functions that transform state (auth, discover, generate, execute, heal, report)
- **Edges**: conditional transitions (execute passes → report; execute fails → heal → execute again)

Running in production at LinkedIn, Uber, and 400+ companies. TypeScript-native. Best observability via LangSmith. Recommended by LangChain team over AgentExecutor for all production agent work as of late 2025.

### Finding 6: No existing tool combines all of this

| Tool | No-selector | Script output | Role-first | Self-hosted | Portable scripts |
|---|---|---|---|---|---|
| testRigor | Yes | No (black box) | No | No | No |
| Playwright MCP | Yes | No (live only) | No | Yes | No |
| browser-use | Yes | No | No | Yes | No |
| Functionize/Mabl | Partial | No | No | No | No |
| **This system** | **Yes** | **Yes (.spec.ts)** | **Yes** | **Yes** | **Yes** |

**The gap no one has filled:** a self-hosted, role-first, no-selector pipeline that produces portable, readable, cached test scripts from natural language prompts — with the accessibility tree as the element resolution strategy.

---

## Proposed Solution

### One-sentence proposition
An AI test automation pipeline where prompts are the canonical test definitions, the browser's own accessibility tree is the element resolution engine, and the output is cached, portable, human-readable Playwright TypeScript scripts — no selectors, no human curation, no black box.

---

### The Five-Stage Pipeline

```
[Entry]           URL + roles.ts + prompt steps
     ↓
[Discovery]       Accessibility tree snapshot of the live page
     ↓
[Element Library] Auto-generated semantic map: "Submit button", "Email field", etc.
     ↓
[Script Gen]      LLM maps each prompt step to elements → Playwright script (cached)
     ↓
[Execution]       Playwright runs script → results, screenshots on failure, video
```

---

### Architecture Decision Table

| Decision | Choice | Rationale |
|---|---|---|
| Element strategy | Accessibility tree first | Browser-native, zero instrumentation, works on any app, LLM-friendly, proven by Playwright MCP |
| Visual detection | Fallback only | Canvas, image text, broken ARIA — cover the gaps without building around the exception |
| Script lifecycle | Generate-once, cache, regenerate on failure | Reproducibility for CI; resilience when UI changes; prompts stay canonical |
| Script format | Playwright TypeScript | Standard, portable, readable, diffable, self-hostable — teams keep ownership |
| Role model | First-class via `.ts` file | Version-controllable, code-adjacent, explicit — not a UI configuration afterthought |
| Execution | Self-hosted | CI/CD pipelines, no SaaS dependency, credentials never leave the environment |

---

### Role-Based Testing Model

The `.ts` definition file describes users: name, credentials, role, and attributes (e.g., `hasAdminPanel: true`, `region: EU`). The pipeline logs in as each defined user before executing the test suite. A single set of prompts runs across all defined roles. Assertions reference role attributes:

> "Verify the admin panel is visible for admin role, not for viewer role"

The LLM understands this from the role attributes in the `.ts` file and generates conditional assertions in the output script:

```typescript
if (role.attributes.hasAdminPanel) {
  await expect(page.getByRole('link', { name: 'Admin' })).toBeVisible();
} else {
  await expect(page.getByRole('link', { name: 'Admin' })).not.toBeVisible();
}
```

---

### Self-Healing Model

When a script fails, before reporting failure the pipeline:
1. Re-runs discovery (fresh accessibility tree snapshot)
2. Compares element library to cached version (did the UI change?)
3. If elements changed → regenerates only the affected script steps, recaches
4. If elements unchanged → reports as a genuine test failure

This is the right division of labor: the system heals selector drift automatically, but does not hide real bugs.

Maximum one heal attempt per run. Unlimited healing would mask genuine failures and inflate LLM costs.

---

### POC Hypothesis to Validate

> Can the accessibility tree, combined with an LLM, reliably and consistently resolve natural language test step descriptions to the correct interactive element across real-world apps — including apps with poor accessibility compliance?

This single question gates everything else. Playwright MCP's traction suggests yes for modern apps. The unknown is poorly accessible apps — and that is where the visual fallback layer matters.

The POC should benchmark this across a range of apps: a well-built SPA, a legacy enterprise app, an e-commerce site, and a dashboard app. The failure rate on element resolution determines how much the visual fallback needs to carry.

---

## What Can Be Coded vs. What Depends on AI

### What can be coded (deterministic)

| Component | Confidence |
|---|---|
| Browser control and navigation (Playwright) | 100% |
| Accessibility tree extraction | 100% |
| Role/credential loading from `.ts` file | 100% |
| Standard form-based authentication | 100% |
| Script caching, versioning, storage | 100% |
| Test execution and result collection | 100% |
| Pipeline orchestration (LangGraph) | 100% |
| Self-healing trigger logic | 100% |
| tsc compile validation of generated scripts | 100% |

### What depends on AI capability (probabilistic)

| Component | Estimated Reliability | Main Risk |
|---|---|---|
| Element resolution from natural language | 70–80% | Ambiguous labels, icon-only elements, poor ARIA |
| Assertion generation | 50–65% | Intent gap — LLM guesses what success means |
| Script correctness for complex flows | 75–85% | Async timing, wrong interaction type, missing prerequisites |
| Handling unexpected page states | Unpredictable | Modals, banners, spinners not in the prompt |
| Apps with poor accessibility | Significantly lower | Sparse tree → LLM has less signal |

### Autonomy spectrum for the POC

| Dimension | Level | Bottleneck |
|---|---|---|
| Navigation and interaction | High (80–90%) | Unexpected states, missing ARIA |
| Authentication (standard login) | High | MFA, SSO, CAPTCHA are out of scope |
| Element resolution | Medium (70–80%) | Ambiguous labels, icon-only elements |
| Assertion generation | Medium-Low (50–65%) | Intent gap |
| Self-healing (selector drift) | Medium (70%) | Works for UI changes, not logic changes |
| Full end-to-end, no human | Medium (60–70%) | On modern, well-built apps only |

### The honest POC boundary

**The POC can autonomously prove:**
- Accessibility tree → element library, without human input, works
- Natural language step → Playwright script, works for standard flows
- The pipeline runs without human involvement from prompt to result

**The POC cannot fully resolve:**
- Whether generated assertions actually match the user's intent
- How it behaves on real enterprise apps with poor accessibility
- Whether 65–75% reliability is acceptable or needs to reach 95%+

**Practical implication:** The POC should include a human review step — not for element selection or scripting, but specifically for validating that the generated assertions match the intent of the original prompts. This is not a design failure; it is an honest acknowledgment of where AI capability currently stops. As models improve, that review step shrinks.
