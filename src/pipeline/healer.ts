import fs from 'fs/promises';
import type { ElementLibrary, TestSuite, ExecutionResult } from '../config/types';
import { generateCode } from '../llm/client';
import { SCRIPT_HEALER_SYSTEM, buildHealerPrompt } from '../llm/prompts';
import { injectCookieDismissal, stripCodeFences } from '../generator/generator';

/**
 * Attempt to self-heal a failing Playwright script.
 * Sends the failing script + error to Claude Sonnet and asks it to fix the issue.
 * Writes the healed version to a sibling -healed.spec.ts file, leaving the original
 * untouched so it is available for debugging if the heal also fails.
 * Returns the healed script path on success, null if the original could not be read.
 */
export async function healScript(
  suite: TestSuite,
  library: ElementLibrary,
  scriptPath: string,
  executionResult: ExecutionResult,
): Promise<string | null> {
  const failingScript = await fs.readFile(scriptPath, 'utf8').catch(() => null);
  if (!failingScript) return null;

  const userPrompt = buildHealerPrompt(failingScript, executionResult, library);

  console.log(`  [heal] Calling Claude Sonnet to fix script...`);
  const raw = await generateCode(SCRIPT_HEALER_SYSTEM, userPrompt);
  const healed = injectCookieDismissal(stripCodeFences(raw), library.consentInfo);

  const healedPath = scriptPath.replace(/\.spec\.ts$/, '-healed.spec.ts');
  await fs.writeFile(healedPath, healed, 'utf8');
  console.log(`  [heal] Healed script written → ${healedPath}`);
  return healedPath;
}
