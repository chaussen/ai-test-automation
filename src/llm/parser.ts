import type { TestSuite } from '../config/types';
import { extract } from './client';

const PARSE_SYSTEM = `\
You are a test suite extractor. Given a natural language description of what to test, extract a structured test suite.

Output ONLY a valid JSON object — no markdown fences, no explanation:
{
  "name": "Short descriptive name for this test suite",
  "url": "https://the-full-url-to-test.com/",
  "steps": [
    "Step 1 as a complete, actionable sentence",
    "Step 2 as a complete, actionable sentence"
  ]
}

Rules:
- url must be a valid https:// URL found in the input — include the full URL with path if given
- name should summarise what is being tested in 4-8 words
- steps must be discrete — one action OR one verification per step, never both
- write steps as imperative sentences: "Verify...", "Click...", "Navigate to...", "Check..."
- aim for 3-10 steps; expand vague descriptions into concrete testable steps
- do NOT include a step for the initial page load — the test framework navigates to the URL automatically
- if no URL can be found, return {"error": "No URL found in prompt"}`;

interface ParsedSuite {
  name: string;
  url: string;
  steps: string[];
  error?: string;
}

export async function parsePromptToSuite(prompt: string): Promise<TestSuite> {
  const raw = await extract(PARSE_SYSTEM, prompt);

  // Strip accidental markdown fences
  const clean = raw
    .replace(/^```(?:json)?\s*/m, '')
    .replace(/\s*```\s*$/m, '')
    .trim();

  let parsed: ParsedSuite;
  try {
    parsed = JSON.parse(clean) as ParsedSuite;
  } catch {
    throw new Error(`[parser] Could not parse model response as JSON:\n${clean}`);
  }

  if (parsed.error) {
    throw new Error(`[parser] ${parsed.error}`);
  }

  if (!parsed.url || !parsed.steps?.length) {
    throw new Error('[parser] Model returned incomplete test suite (missing url or steps)');
  }

  try {
    new URL(parsed.url);
  } catch {
    throw new Error(`[parser] Model returned an invalid URL: "${parsed.url}"`);
  }

  return {
    name: parsed.name,
    url: parsed.url,
    steps: parsed.steps,
    roles: [],
  };
}
