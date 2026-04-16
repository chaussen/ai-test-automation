import fs from 'fs/promises';
import path from 'path';
import type { ElementLibrary, TestSuite, ConsentInfo } from '../config/types';
import { generateCode } from '../llm/client';
import { SCRIPT_GENERATOR_SYSTEM, buildScriptPrompt } from '../llm/prompts';

const SCRIPTS_DIR = '.ata/scripts';

/**
 * Strip markdown code fences if the LLM wrapped the output in them.
 * Returns clean TypeScript source.
 */
export function stripCodeFences(raw: string): string {
  // Remove ```typescript or ```ts or ``` fences
  return raw
    .replace(/^```(?:typescript|ts)?\s*\n?/m, '')
    .replace(/\n?```\s*$/m, '')
    .trim();
}

/**
 * Inject cookie/consent banner dismissal after every navigation event
 * (page.goto and page.goBack). Uses the exact label recorded during discovery
 * when available, falling back to a broad regex for unknown sites.
 */
export function injectCookieDismissal(code: string, consent?: ConsentInfo): string {
  // Use the exact label recorded during discovery for a targeted match,
  // or fall back to a broad regex if no banner was detected (or library is from an old run)
  const nameMatch = consent?.buttonLabel
    ? JSON.stringify(consent.buttonLabel)
    : '/accept all|accept all cookies|allow all cookies|allow all|i accept|agree/i';

  const dismissal = `
    // Dismiss cookie/consent banner if present
    try {
      const cookieBtn = page.getByRole('button', { name: ${nameMatch} });
      if (await cookieBtn.count() > 0) {
        await cookieBtn.first().click({ timeout: 3000 });
        await page.waitForTimeout(800);
      }
    } catch { /* no banner present */ }
`;
  // Inject after every full-page navigation: goto, goBack, and click-triggered loads
  let result = code.replace(/(await page\.goto\([^)]+\);)/g, `$1\n${dismissal}`);
  result = result.replace(/(await page\.goBack\(\);)/g, `$1\n${dismissal}`);
  result = result.replace(/(await page\.waitForLoadState\('domcontentloaded'\);)/g, `$1\n${dismissal}`);
  return result;
}

/**
 * Generate a complete Playwright .spec.ts file for the given suite and element library.
 * Returns the absolute path to the written file.
 */
export async function generateScript(
  suite: TestSuite,
  library: ElementLibrary,
  scriptHash: string,
): Promise<string> {
  await fs.mkdir(SCRIPTS_DIR, { recursive: true });

  const userPrompt = buildScriptPrompt(suite, library);

  console.log(`  [generator] Calling Claude Sonnet to generate test script...`);
  const raw = await generateCode(SCRIPT_GENERATOR_SYSTEM, userPrompt);
  const code = injectCookieDismissal(stripCodeFences(raw), library.consentInfo);

  const filePath = path.join(SCRIPTS_DIR, `${scriptHash}.spec.ts`);
  await fs.writeFile(filePath, code, 'utf8');

  console.log(`  [generator] Script written → ${filePath}`);
  return filePath;
}
