import path from 'path';
import fs from 'fs/promises';
import { execFile } from 'child_process';
import { promisify } from 'util';
import type { TestSuite, Role, ExecutionResult, RunResult, RunMetrics, StepResult, ElementLibrary } from '../config/types';
import { BrowserController } from '../browser/controller';
import { buildElementLibrary } from '../elements/builder';
import { saveElementLibrary, loadElementLibrary } from '../elements/cache';
import { diffLibraries } from '../elements/diff';
import { generateScript } from '../generator/generator';
import { healScript } from './healer';
import {
  computeScriptHash,
  getCachedScript,
  recordScript,
  updateRunResult,
  invalidateScriptsForUrl,
} from '../generator/cache';

const execFileAsync = promisify(execFile);

const RESULTS_DIR = '.ata/results';
const PUBLIC_ROLE: Role = { name: 'public', attributes: {} };

// ─── Main pipeline entry ──────────────────────────────────────────────────────

export async function runSuite(
  suite: TestSuite,
  allRoles: Role[],
  options: { noCache?: boolean } = {},
): Promise<RunResult[]> {
  const rolesToRun: Role[] =
    suite.roles.length === 0
      ? [PUBLIC_ROLE]
      : suite.roles.map((name) => {
          const role = allRoles.find((r) => r.name === name);
          if (!role) throw new Error(`[pipeline] Role "${name}" not found in roles config`);
          return role;
        });

  const results: RunResult[] = [];
  for (const role of rolesToRun) {
    console.log(`\n${'─'.repeat(60)}`);
    console.log(`  Suite : ${suite.name}`);
    console.log(`  Role  : ${role.name}`);
    console.log(`  URL   : ${suite.url}`);
    console.log(`${'─'.repeat(60)}`);

    const result = await runForRole(suite, role, options);
    results.push(result);
  }
  return results;
}

// ─── Per-role pipeline ────────────────────────────────────────────────────────

async function runForRole(suite: TestSuite, role: Role, options: { noCache?: boolean } = {}): Promise<RunResult> {
  const pipelineStart = Date.now();
  const metrics: RunMetrics = {
    llmCalls: 0,
    cacheHit: false,
    healAttempted: false,
    healSucceeded: false,
    pageChanged: false,
    elementCount: 0,
  };

  const hash = computeScriptHash(suite.url, suite.steps);

  // ── Step 1: Discovery ──────────────────────────────────────────────────────
  console.log(`\n  [1/4] Discovery — capturing accessibility tree...`);
  const browser = new BrowserController();
  let libraryPath: string | null = null;
  let scriptPath: string | null = null;
  let capturedLibrary: ElementLibrary | null = null;

  await browser.launch({ headless: true });
  try {
    const consentInfo = await browser.navigate(suite.url);
    const rawNodes = await browser.captureAccessibilityTree();
    console.log(`        Raw nodes captured: ${rawNodes.length}`);
    if (consentInfo.found) {
      console.log(`        Consent banner dismissed (label: "${consentInfo.buttonLabel}")`);
    }

    capturedLibrary = buildElementLibrary(rawNodes, suite.url, consentInfo);
    metrics.elementCount = capturedLibrary.elements.length;
    console.log(`        Element library: ${capturedLibrary.elements.length} elements (from ${capturedLibrary.totalRawNodes} raw nodes)`);

    // ── Diff against previous library ───────────────────────────────────────
    const previousLibrary = await loadElementLibrary(capturedLibrary.urlHash);
    if (previousLibrary) {
      const diff = diffLibraries(previousLibrary, capturedLibrary);
      if (diff.changed) {
        metrics.pageChanged = true;
        console.log(`        [diff] Page changed: ${diff.summary}`);
        const invalidated = await invalidateScriptsForUrl(suite.url);
        if (invalidated > 0) {
          console.log(`        [diff] Invalidated ${invalidated} cached script(s)`);
        }
      } else {
        console.log(`        [diff] Page unchanged`);
      }
    }

    libraryPath = await saveElementLibrary(capturedLibrary);
    console.log(`        Library saved → ${libraryPath}`);

    // ── Step 2: Script Generation ────────────────────────────────────────────
    console.log(`\n  [2/4] Generation — building test script...`);

    const cached = options.noCache ? null : await getCachedScript(hash, capturedLibrary.hash);
    if (cached) {
      scriptPath = cached;
      metrics.cacheHit = true;
      console.log(`        [cache] Cache hit — using ${scriptPath}`);
    } else {
      scriptPath = await generateScript(suite, capturedLibrary, hash);
      metrics.llmCalls++;
      await recordScript(hash, scriptPath, suite.url, suite.steps.length, capturedLibrary.hash);
    }
  } finally {
    await browser.close();
  }

  if (!scriptPath || !capturedLibrary || !libraryPath) {
    throw new Error('[pipeline] Discovery or generation did not complete');
  }

  // ── Step 3: Execution ────────────────────────────────────────────────────
  console.log(`\n  [3/4] Execution — running Playwright tests...`);
  let executionResult = await executeScript(scriptPath, suite.steps);

  // ── Self-heal on failure ─────────────────────────────────────────────────
  if (executionResult.status === 'failed') {
    console.log(`\n  [heal] Test failed — attempting self-heal...`);
    metrics.healAttempted = true;

    const healedPath = await healScript(suite, capturedLibrary, scriptPath, executionResult);
    if (healedPath) {
      metrics.llmCalls++;
      console.log(`  [heal] Re-executing healed script...`);
      const healedResult = await executeScript(healedPath, suite.steps);
      if (healedResult.status === 'passed') {
        metrics.healSucceeded = true;
        await fs.copyFile(healedPath, scriptPath);
        console.log(`  [heal] ✓ Heal succeeded`);
      } else {
        console.log(`  [heal] ✗ Heal did not fix the test`);
      }
      executionResult = healedResult;
    }
  }

  await updateRunResult(hash, executionResult.status);

  // ── Step 4: Result ───────────────────────────────────────────────────────
  console.log(`\n  [4/4] Done. (${((Date.now() - pipelineStart) / 1000).toFixed(1)}s)`);

  return {
    suite: suite.name,
    url: suite.url,
    role: role.name,
    executionResult,
    scriptPath,
    cacheHit: metrics.cacheHit,
    elementLibraryPath: libraryPath,
    metrics,
  };
}

// ─── Playwright execution ─────────────────────────────────────────────────────

async function executeScript(
  scriptPath: string,
  steps: string[],
): Promise<ExecutionResult> {
  await fs.mkdir(RESULTS_DIR, { recursive: true });

  const resultsFile = path.join(RESULTS_DIR, 'results.json');
  // Remove stale results file
  await fs.rm(resultsFile, { force: true });

  const configPath = path.resolve('playwright.config.ts');
  const absScriptPath = path.resolve(scriptPath);

  const start = Date.now();
  let stdout = '';
  let stderr = '';

  try {
    const result = await execFileAsync(
      'npx',
      [
        'playwright', 'test',
        absScriptPath,
        '--config', configPath,
      ],
      {
        cwd: process.cwd(),
        timeout: 120_000,
        env: { ...process.env },
      },
    );
    stdout = result.stdout;
    stderr = result.stderr;
  } catch (err: unknown) {
    // playwright exits with non-zero on test failure — that's normal
    const e = err as { stdout?: string; stderr?: string };
    stdout = e.stdout ?? '';
    stderr = e.stderr ?? '';
  }

  const duration = Date.now() - start;

  // Print playwright output
  if (stdout) process.stdout.write(stdout);
  if (stderr) process.stderr.write(stderr);

  // Parse JSON results
  return parseResults(resultsFile, steps, duration);
}

async function parseResults(
  resultsFile: string,
  steps: string[],
  totalDuration: number,
): Promise<ExecutionResult> {
  let raw: PlaywrightJsonReport | null = null;
  try {
    const content = await fs.readFile(resultsFile, 'utf8');
    raw = JSON.parse(content) as PlaywrightJsonReport;
  } catch {
    // Results file missing — all steps failed
    return buildFailedResult(steps, totalDuration, 'Playwright results file not found');
  }

  const stepResults: StepResult[] = [];
  let passedSteps = 0;
  let failedSteps = 0;

  // Flatten all test specs from the report
  const allTests = collectTests(raw);

  if (allTests.length === 0) {
    return buildFailedResult(steps, totalDuration, 'No tests found in results');
  }

  // Map tests back to steps by index
  for (let i = 0; i < steps.length; i++) {
    const testResult = allTests[i];
    if (!testResult) {
      stepResults.push({
        index: i,
        prompt: steps[i],
        status: 'skipped',
        duration: 0,
      });
      continue;
    }

    const status = testResult.status === 'passed' ? 'passed'
      : testResult.status === 'skipped' ? 'skipped'
      : 'failed';

    if (status === 'passed') passedSteps++;
    else if (status === 'failed') failedSteps++;

    const result: StepResult = {
      index: i,
      prompt: steps[i],
      status,
      duration: testResult.duration ?? 0,
    };

    if (status === 'failed' && testResult.error) {
      result.error = testResult.error.message ?? String(testResult.error);
    }

    stepResults.push(result);
  }

  // Handle case where playwright ran a single combined test
  if (allTests.length === 1) {
    const single = allTests[0];
    const overallPassed = single.status === 'passed';
    return {
      status: overallPassed ? 'passed' : 'failed',
      totalSteps: steps.length,
      passedSteps: overallPassed ? steps.length : 0,
      failedSteps: overallPassed ? 0 : steps.length,
      duration: totalDuration,
      steps: steps.map((prompt, i) => ({
        index: i,
        prompt,
        status: overallPassed ? 'passed' : (i === 0 ? 'failed' : 'skipped'),
        duration: single.duration ? Math.round(single.duration / steps.length) : 0,
        error: !overallPassed && i === 0 ? (single.error?.message ?? 'Test failed') : undefined,
      })),
      reportPath: 'reports/html',
    };
  }

  return {
    status: failedSteps > 0 ? 'failed' : 'passed',
    totalSteps: steps.length,
    passedSteps,
    failedSteps,
    duration: totalDuration,
    steps: stepResults,
    reportPath: 'reports/html',
  };
}

function buildFailedResult(
  steps: string[],
  duration: number,
  error: string,
): ExecutionResult {
  return {
    status: 'failed',
    totalSteps: steps.length,
    passedSteps: 0,
    failedSteps: steps.length,
    duration,
    steps: steps.map((prompt, i) => ({
      index: i,
      prompt,
      status: 'failed' as const,
      error: i === 0 ? error : undefined,
      duration: 0,
    })),
    reportPath: 'reports/html',
  };
}

// ─── Playwright JSON report types (minimal) ───────────────────────────────────

interface PlaywrightTestResult {
  status: 'passed' | 'failed' | 'skipped' | 'timedOut';
  duration?: number;
  error?: { message?: string };
  attachments?: Array<{ name: string; path?: string }>;
}

interface PlaywrightSpec {
  title: string;
  tests: Array<{ results: PlaywrightTestResult[] }>;
}

interface PlaywrightSuite {
  title: string;
  specs?: PlaywrightSpec[];
  suites?: PlaywrightSuite[];
}

interface PlaywrightJsonReport {
  suites?: PlaywrightSuite[];
}

interface FlatTest {
  title: string;
  status: 'passed' | 'failed' | 'skipped' | 'timedOut';
  duration?: number;
  error?: { message?: string };
}

function collectTests(report: PlaywrightJsonReport): FlatTest[] {
  const results: FlatTest[] = [];

  function walkSuite(suite: PlaywrightSuite): void {
    for (const spec of suite.specs ?? []) {
      const result = spec.tests?.[0]?.results?.[0];
      if (result) {
        results.push({
          title: spec.title,
          status: result.status,
          duration: result.duration,
          error: result.error,
        });
      }
    }
    for (const sub of suite.suites ?? []) {
      walkSuite(sub);
    }
  }

  for (const suite of report.suites ?? []) {
    walkSuite(suite);
  }

  return results;
}
