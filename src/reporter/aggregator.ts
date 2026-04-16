import fs from 'fs/promises';
import path from 'path';
import type { RunResult } from '../config/types';

const REPORTS_DIR = 'reports';

export async function printAndSaveReport(results: RunResult[]): Promise<void> {
  const timestamp = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19);
  const reportDir = path.join(REPORTS_DIR, timestamp);
  await fs.mkdir(reportDir, { recursive: true });

  console.log(`\n${'═'.repeat(60)}`);
  console.log(`  ATA Run Report — ${new Date().toLocaleString()}`);
  console.log(`${'═'.repeat(60)}`);

  for (const result of results) {
    printSuiteResult(result);
  }

  // Overall summary
  const totalPassed = results.filter((r) => r.executionResult.status === 'passed').length;
  const totalFailed = results.filter((r) => r.executionResult.status === 'failed').length;

  console.log(`\n${'─'.repeat(60)}`);
  console.log(`  Overall: ${totalPassed} passed, ${totalFailed} failed out of ${results.length} suite(s)`);
  if (totalFailed === 0) {
    console.log(`  ✓ All suites passed`);
  } else {
    console.log(`  ✗ ${totalFailed} suite(s) failed`);
  }
  console.log(`${'─'.repeat(60)}\n`);

  // Save JSON summary
  const summaryPath = path.join(reportDir, 'summary.json');
  await fs.writeFile(summaryPath, JSON.stringify(results, null, 2), 'utf8');
  console.log(`  JSON summary → ${summaryPath}`);
  console.log(`  HTML report  → reports/html/index.html`);
}

function printSuiteResult(result: RunResult): void {
  const { executionResult: exec } = result;
  const statusIcon = exec.status === 'passed' ? '✓' : '✗';
  const durationSec = (exec.duration / 1000).toFixed(1);

  console.log(`\n  ${statusIcon} ${result.suite} [${result.role}]`);
  console.log(`    URL    : ${result.url}`);
  console.log(`    Cache  : ${result.cacheHit ? 'HIT' : 'MISS — script generated'}`);
  console.log(`    Script : ${result.scriptPath}`);
  console.log(`    Result : ${exec.passedSteps}/${exec.totalSteps} steps passed (${durationSec}s)`);

  if (result.metrics) {
    const m = result.metrics;
    const healInfo = m.healAttempted
      ? ` | heal: ${m.healSucceeded ? 'succeeded' : 'failed'}`
      : '';
    console.log(`    Metrics: ${m.llmCalls} LLM call(s) | elements: ${m.elementCount} | page changed: ${m.pageChanged}${healInfo}`);
  }

  console.log('');
  for (const step of exec.steps) {
    const icon = step.status === 'passed' ? '  ✓' : step.status === 'skipped' ? '  -' : '  ✗';
    const dur = step.duration > 0 ? ` (${(step.duration / 1000).toFixed(1)}s)` : '';
    console.log(`  ${icon} Step ${step.index + 1}: ${step.prompt}${dur}`);
    if (step.error) {
      // Trim long error messages
      const msg = step.error.slice(0, 200).replace(/\n/g, ' ');
      console.log(`      Error: ${msg}`);
    }
  }
}
