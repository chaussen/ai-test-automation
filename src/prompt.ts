import 'dotenv/config';
import readline from 'readline';
import type { TestSuite } from './config/types';
import { parsePromptToSuite } from './llm/parser';
import { runSuite } from './pipeline/runner';
import { printAndSaveReport } from './reporter/aggregator';

// ─── Input ────────────────────────────────────────────────────────────────────

async function readPrompt(): Promise<string> {
  // One-shot: arguments passed directly on the command line
  const args = process.argv.slice(2).join(' ').trim();
  if (args) return args;

  // Interactive: read a single line from stdin
  return new Promise((resolve) => {
    const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
    process.stdout.write('  Describe what you want to test (URL + steps in plain English):\n\n  > ');
    rl.once('line', (line) => {
      rl.close();
      resolve(line.trim());
    });
  });
}

// ─── Entry point ──────────────────────────────────────────────────────────────

async function main(): Promise<void> {
  console.log('\n  AI Test Automation — Prompt Mode');
  console.log('  ─────────────────────────────────\n');

  const input = await readPrompt();
  if (!input) {
    console.error('  [error] No prompt provided.');
    process.exit(1);
  }

  // Echo back what was received in one-shot mode so the output is self-contained
  if (process.argv.slice(2).length > 0) {
    console.log(`  Prompt : "${input}"\n`);
  }

  console.log('  [parsing] Extracting test suite from prompt...');
  let suite: TestSuite;
  try {
    suite = await parsePromptToSuite(input);
  } catch (err) {
    console.error(`  [error] ${(err as Error).message}`);
    process.exit(1);
  }

  console.log(`  Suite  : ${suite.name}`);
  console.log(`  URL    : ${suite.url}`);
  console.log(`  Steps  : ${suite.steps.length}`);
  suite.steps.forEach((s, i) => console.log(`           ${i + 1}. ${s}`));
  console.log('');

  const results = await runSuite(suite, []);
  await printAndSaveReport(results);

  const anyFailed = results.some((r) => r.executionResult.status === 'failed');
  process.exit(anyFailed ? 1 : 0);
}

main().catch((err) => {
  console.error('\n  [fatal]', (err as Error).message ?? err);
  process.exit(1);
});
