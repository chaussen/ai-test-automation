import type { ElementLibrary, TestSuite, ExecutionResult } from '../config/types';

// ─── System prompt ────────────────────────────────────────────────────────────

export const SCRIPT_GENERATOR_SYSTEM = `\
You are a Playwright TypeScript end-to-end test script generator.

Your job is to produce a complete, valid Playwright test file from a list of natural language test steps and a library of page elements.

Rules:
- Output ONLY raw TypeScript code. No markdown code fences. No explanation. No commentary outside code comments.
- Use a single test.describe block containing a single test() with all steps in sequence.
- Each step must be preceded by a comment: // Step N: <the original step text>
- Use ONLY the locators listed in the element library. Do not invent selectors. Do not remove or modify the locator — copy it exactly as written, including any .first() suffix.
- When a step says "navigate" or "go to", use page.goto(url, { waitUntil: 'domcontentloaded' }).
- When a step says "go back" or "navigate back", use: await page.goBack(); await page.waitForLoadState('domcontentloaded'); await page.waitForLoadState('networkidle').catch(() => {});
- When a step implies verification ("verify", "check", "confirm", "ensure"), add an expect() assertion.
- Always await every Playwright action and assertion.
- For all link click actions pass { force: true }, e.g. await locator.click({ force: true }). This is required because navigation menus often have invisible CSS overlay elements that intercept pointer events.
- After a click that triggers navigation, add: await page.waitForLoadState('domcontentloaded');
- Never use conditional URL checks (if/else on page.url()). Always assert directly: await expect(page).toHaveURL(/pattern/);
- To submit a text input (e.g. search, todo), use: await locator.fill('text'); await locator.press('Enter');
- If a step cannot be mapped to any element in the library, write a comment explaining why and skip it gracefully with a console.log.
- Use only the imports shown in the output format below — do not add any others.
- The variables \`page\`, \`expect\`, \`test\`, and \`baseURL\` are all in scope.
`;

// ─── User prompt ──────────────────────────────────────────────────────────────

export function buildScriptPrompt(suite: TestSuite, library: ElementLibrary): string {
  const elementList = library.elements
    .map(
      (e, i) =>
        `${String(i + 1).padStart(3, ' ')}. [${e.role.padEnd(12)}] ${e.description}\n       Locator: ${e.locator}`,
    )
    .join('\n');

  const stepList = suite.steps
    .map((step, i) => `${i + 1}. ${step}`)
    .join('\n');

  return `\
## Test Suite
Name: ${suite.name}
Base URL: ${suite.url}

## Available Page Elements (${library.elements.length} total)
Use ONLY these locators. Do not invent selectors.

${elementList}

## Test Steps (execute in this exact order, in a single test() block)
${stepList}

## Required Output Format
\`\`\`
import { test, expect } from '@playwright/test';

test.describe('<suite name>', () => {
  test('<suite name> - full flow', async ({ page }) => {
    await page.goto('<url>');

    // Step 1: <step text>
    <generated code for step 1>

    // Step 2: <step text>
    <generated code for step 2>

    // ... and so on
  });
});
\`\`\`

Generate the complete test file now. Output ONLY the TypeScript code — no explanation, no markdown fences.`;}

// ─── Healer prompt ────────────────────────────────────────────────────────────

export const SCRIPT_HEALER_SYSTEM = `\
You are a Playwright TypeScript test debugger.

Given a failing test script and its error, produce a corrected version.

Rules:
- Output ONLY the corrected TypeScript — no markdown fences, no explanations
- Preserve ALL existing code: imports, test.describe/test() structure, step comments, cookie dismissal blocks
- Make the MINIMUM change required to fix the reported error
- For "element not found": choose a different locator from the element library with the same semantic intent
- For timeout / element not visible: try a different locator or assertion approach
- For URL assertion failures: adjust the URL regex pattern to match the actual destination
- Keep all { force: true } on clicks, { waitUntil: 'domcontentloaded' } on goto calls
- Never remove or alter the cookie dismissal try-catch blocks
`;

export function buildHealerPrompt(
  failingScript: string,
  executionResult: ExecutionResult,
  library: ElementLibrary,
): string {
  const primaryError = executionResult.steps.find((s) => s.error)?.error ?? 'Unknown error';

  const elementList = library.elements
    .map(
      (e, i) =>
        `${String(i + 1).padStart(3, ' ')}. [${e.role.padEnd(12)}] ${e.description}\n       Locator: ${e.locator}`,
    )
    .join('\n');

  return `\
## Failing Script
${failingScript}

## Error
${primaryError.slice(0, 800)}

## Available Element Library (${library.elements.length} elements)
${elementList}

Output the corrected script.`;
}
