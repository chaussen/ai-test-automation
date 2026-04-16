// ─── User-facing config types (written by the user) ────────────────────────

export interface Role {
  name: string;
  credentials?: {
    email: string;
    password: string;
  };
  attributes: Record<string, string | boolean | number>;
}

export interface TestSuite {
  name: string;
  url: string;
  /** Role names from roles config. Empty array = run as public (unauthenticated) user. */
  roles: string[];
  steps: string[];
}

// ─── Internal pipeline types ─────────────────────────────────────────────────

/** A node in the raw accessibility tree as returned by Playwright, after flattening */
export interface RawAccessibilityNode {
  role: string;
  name?: string;
  description?: string;
  value?: string | number;
  checked?: boolean;
  disabled?: boolean;
  expanded?: boolean;
  required?: boolean;
  focused?: boolean;
  hidden?: boolean;
  level?: number;
  // Injected during normalization
  path: string;    // breadcrumb: "banner > navigation > list > listitem > link"
  depth: number;
}

/** A resolved, LLM-ready entry in the element library */
export interface ElementEntry {
  id: string;          // SHA-256(role::name::path).slice(0, 16)
  role: string;        // ARIA role: button, link, textbox, heading, etc.
  name: string;        // accessible name
  description: string; // human-readable: "Study link in the main navigation"
  locator: string;     // Playwright locator string: page.getByRole('link', { name: 'Study' })
  locatorType: 'getByRole' | 'getByLabel' | 'getByText' | 'getByPlaceholder' | 'visual';
  pageSection: string; // inferred from ARIA landmark: "navigation", "main", "footer", etc.
}

/** Result of cookie/consent banner dismissal during discovery */
export interface ConsentInfo {
  found: boolean;
  buttonLabel: string | null;  // exact label that was clicked; null if no banner found
}

/** The full element library for a given URL snapshot */
export interface ElementLibrary {
  url: string;
  urlHash: string;
  capturedAt: string;  // ISO 8601
  hash: string;        // SHA-256 of serialised elements (for change detection)
  totalRawNodes: number;
  elements: ElementEntry[];
  consentInfo: ConsentInfo;
}

/** Result of a single test step execution */
export interface StepResult {
  index: number;
  prompt: string;
  status: 'passed' | 'failed' | 'skipped';
  error?: string;
  screenshotPath?: string;
  duration: number; // ms
}

/** Aggregated result of a full test run */
export interface ExecutionResult {
  status: 'passed' | 'failed';
  totalSteps: number;
  passedSteps: number;
  failedSteps: number;
  duration: number; // ms
  steps: StepResult[];
  reportPath: string;
}

/** Per-run pipeline metrics */
export interface RunMetrics {
  llmCalls: number;        // total LLM API calls made this run
  cacheHit: boolean;       // whether script was served from cache
  healAttempted: boolean;  // whether self-heal was triggered
  healSucceeded: boolean;  // whether self-heal fixed the test
  pageChanged: boolean;    // whether element library diff detected a change
  elementCount: number;    // elements in library sent to LLM
}

/** Top-level result returned by the pipeline for one suite+role combination */
export interface RunResult {
  suite: string;
  url: string;
  role: string;
  executionResult: ExecutionResult;
  scriptPath: string;
  cacheHit: boolean;
  elementLibraryPath: string;
  metrics: RunMetrics;
}
