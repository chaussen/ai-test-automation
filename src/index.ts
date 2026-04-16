import 'dotenv/config';
import path from 'path';
import type { Role, TestSuite } from './config/types';
import { loadSuites, loadRoles } from './config/loader';
import { runSuite } from './pipeline/runner';
import { printAndSaveReport } from './reporter/aggregator';

// ─── CLI argument parsing ─────────────────────────────────────────────────────

function parseArgs(): { stepsFile: string; rolesFile: string | null; suiteName: string | null; noCache: boolean } {
  const args = process.argv.slice(2);
  let stepsFile = 'examples/steps.ts';
  let rolesFile: string | null = null;
  let suiteName: string | null = null;
  let noCache = false;

  for (let i = 0; i < args.length; i++) {
    if (args[i] === '--steps' && args[i + 1]) {
      stepsFile = args[++i];
    } else if (args[i] === '--roles' && args[i + 1]) {
      rolesFile = args[++i];
    } else if (args[i] === '--suite' && args[i + 1]) {
      suiteName = args[++i];
    } else if (args[i] === '--no-cache') {
      noCache = true;
    }
  }

  return { stepsFile, rolesFile, suiteName, noCache };
}

// ─── Entry point ──────────────────────────────────────────────────────────────

async function main(): Promise<void> {
  console.log('\n  AI Test Automation — POC');
  console.log('  ─────────────────────────\n');

  const { stepsFile, rolesFile, suiteName, noCache } = parseArgs();

  if (noCache) {
    console.log('  [info] --no-cache flag set: ignoring cached scripts\n');
  }

  // Load suites
  console.log(`  Loading test suites from: ${stepsFile}`);
  let suites: TestSuite[];
  try {
    suites = await loadSuites(stepsFile);
  } catch (err) {
    console.error(`  [error] Failed to load steps file: ${(err as Error).message}`);
    process.exit(1);
  }

  // Load roles (optional — only needed if suites reference roles)
  let roles: Role[] = [];
  if (rolesFile) {
    console.log(`  Loading roles from: ${rolesFile}`);
    try {
      roles = await loadRoles(rolesFile);
    } catch (err) {
      console.error(`  [error] Failed to load roles file: ${(err as Error).message}`);
      process.exit(1);
    }
  }

  // Filter to specific suite if requested
  const suitesToRun = suiteName
    ? suites.filter((s) => s.name === suiteName)
    : suites;

  if (suitesToRun.length === 0) {
    console.error(
      suiteName
        ? `  [error] No suite found with name "${suiteName}"`
        : '  [error] No test suites found',
    );
    process.exit(1);
  }

  console.log(`  Suites to run: ${suitesToRun.length}`);
  console.log(`  Total steps  : ${suitesToRun.reduce((n, s) => n + s.steps.length, 0)}\n`);

  // Run all suites
  const allResults = [];
  for (const suite of suitesToRun) {
    const results = await runSuite(suite, roles, { noCache });
    allResults.push(...results);
  }

  // Report
  await printAndSaveReport(allResults);

  // Exit with non-zero if any suite failed
  const anyFailed = allResults.some((r) => r.executionResult.status === 'failed');
  process.exit(anyFailed ? 1 : 0);
}

main().catch((err) => {
  console.error('\n  [fatal]', (err as Error).message ?? err);
  process.exit(1);
});
