# AI Test Automation — Refined Requirements

Answers to the open questions from the initial brainstorm, along with analysis of their implications.

---

## Q1: Script generation — one-time or regenerate every run?

**Answer:** Due to the nature of AI, scripts will likely generate differently every time. This can be an advantage and a disadvantage.

### Evaluation

**If scripts regenerate every run, the prompts become the source of truth — not the scripts.**
This is a philosophical shift away from traditional automation where the script is the artifact you maintain.
Here, the prompt IS the test. The script is disposable output.

**Advantages of regeneration:**
- Natural self-healing — no stale selectors, no maintenance when UI changes. The single biggest pain point in automation today is eliminated by design
- Always reflects current app state — generation failure itself becomes a signal ("the AI can't figure out how to do X anymore, maybe the UX changed too much")
- Resilient to refactors — rewrite the frontend, the prompts still mean the same thing
- Implicit coverage validation — if the AI can still interpret the test step, the feature is still discoverable

**Disadvantages of regeneration (serious):**
- Failure attribution becomes ambiguous — did the test fail because the app is broken, or because the AI generated a slightly different path this run?
- CI pipelines depend on determinism — "green yesterday, red today, nothing changed" is a trust-killer for engineering teams
- Execution cost multiplies — LLM generation on every run, not once upfront
- No diffability — you can't compare test run A to test run B at the script level; you can only compare results
- Debugging is indirect — a human can't read "what the test did" as a stable artifact

**Resolution — Generate-and-cache with automatic regeneration on failure:**
Generate once, cache by default. Prompts stay canonical; scripts become versioned snapshots.
Regenerate automatically only when: (a) a test fails, or (b) user explicitly requests regeneration.
This gives resilience without sacrificing debuggability and CI determinism.

---

## Q2: Who is the primary user?

**Answer:** All stakeholders. QAs may not always know how to automate tests, but almost all projects ask for it even when they don't have what it takes to do automation.

### Implications

This is the right ambition but creates a real tension: the prompt language has to be natural enough for a business analyst to write, yet precise enough for the AI to execute reliably.

- **Error messages must be human-readable**, not stack traces
- **Failures need visual evidence** (screenshots, video) because non-technical users can't read DOM diffs
- **The prompt format needs guardrails** — too much freedom leads to untestable prompts; too little feels like learning a new language
- **Assertions need to be abstracted** — the concept of "test assertions" is different from "describing steps," and this confuses non-technical writers
- The word "verify" in a prompt signals an assertion. "Navigate to" signals navigation. "Enter" signals input. These natural language signals must be reliably interpreted.

---

## Q3: Self-hosted or SaaS?

**Answer:** Prefer self-hosted, but the pipeline can use cloud-based hosts like Bitbucket for CI/CD.

### Implications
- The pipeline must run as a CLI tool or local service
- No mandatory cloud dependency for execution
- Credentials never leave the user's environment
- CI/CD integration via standard pipeline steps (e.g., Bitbucket Pipelines, GitHub Actions)
- LLM API calls go to Anthropic (external), so internet access is required — but test execution is local

---

## Q4: Tolerance for flakiness?

**Answer:** No firm answer, but if low maintenance burden is the priority, high tolerance is acceptable.

### Implications

Accepting high flakiness tolerance changes the product's positioning from **regression testing tool** to **sanity/smoke testing tool**. That's not a downgrade — it's a more honest scope.

- Tests are checks that the app is *broadly functional*, not that every pixel and edge case is correct
- A "flaky" result means "investigate manually," not "the build is broken"
- The value is coverage breadth over depth — run 50 smoke tests in minutes, not 5 precise ones

**Risk:** Teams adopt it expecting precise regression coverage and lose trust when it produces noise. That expectation gap needs to be managed at the product level, not the technical level.

---

## Q5: Element library — human-curated or AI-generated?

**Answer:** NO human curation. It is the first and biggest hurdle for a team to start automation without coding skills that they don't know DOM, selector etc.

### Options evaluated

**Option A — DOM attribute injection (non-AI, tooling-based):**
- Tools can instrument apps at the proxy or build level to add stable identifiers automatically
- Advantage: deterministic, fast, no AI needed for element resolution
- Risk: requires access to the build pipeline (not always possible) or a proxy that can rewrite HTML
- Fails for apps you don't own or control

**Option B — Visual detection + AI interpretation:**
- AI sees the page as a human would, identifies elements by visual appearance and context
- Advantage: works on any app, no access needed, matches how non-technical users describe things
- Risk: compute-heavy, brittle to rendering differences, poor at precise assertions

**Option C — Accessibility tree (ARIA) — the winner:**
- Browser-native, always available, zero instrumentation required
- Structured text representation (roles, labels, names, states)
- LLM-friendly: "button: Sign in" is semantically clear
- Works for any app that runs in a browser
- Gap: apps with poor ARIA compliance — visual fallback covers this

**Resolution:**
Primary strategy is the accessibility tree. Visual detection is a fallback for elements the tree can't describe (canvas, image-rendered text, icon-only buttons without ARIA labels).

### The "no curation" requirement means:
- When an element can't be found, the system must fail clearly (not silently guess)
- The element library's entries are inspectable, even if auto-generated
- Humans can see what the AI mapped "login button" to, even if they didn't map it themselves

---

## Q6: CI/CD integrations?

**Answer:** Later — not in POC scope.

---

## Core POC Hypothesis (derived from all answers)

> Can an AI reliably and consistently execute the same natural-language test step against the same app across multiple runs, without human-curated selectors?

This single question gates everything else. The POC is designed to validate or refute this hypothesis across a range of real-world apps.

---

## Synthesized Product Definition

What this system is: an **AI QA agent**, not a traditional test framework.

- Prompts are instructions to an agent
- The element library is its learned knowledge of the app
- The script is its execution plan
- The runner is its action layer

The competitive comparison is not only against Playwright/Cypress ecosystems, but also against emerging browser agents and AI-driven QA services. The frame matters for positioning and design decisions.
