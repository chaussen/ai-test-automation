import { chromium, Browser, BrowserContext, Page } from '@playwright/test';
import type { RawAccessibilityNode, ConsentInfo } from '../config/types';

export interface LaunchOptions {
  headless?: boolean;
}

// ─── CDP accessibility tree types ────────────────────────────────────────────

interface CDPAXValue {
  type: string;
  value?: string | number | boolean;
}

interface CDPAXProperty {
  name: string;
  value: CDPAXValue;
}

interface CDPAXNode {
  nodeId: string;
  parentId?: string;
  childIds?: string[];
  role?: CDPAXValue;
  name?: CDPAXValue;
  description?: CDPAXValue;
  value?: CDPAXValue;
  properties?: CDPAXProperty[];
  ignored?: boolean;
  backendDOMNodeId?: number;
}

interface CDPAXTreeResponse {
  nodes: CDPAXNode[];
}

// ─── BrowserController ────────────────────────────────────────────────────────

export class BrowserController {
  private browser: Browser | null = null;
  private context: BrowserContext | null = null;
  private page: Page | null = null;

  async launch(options: LaunchOptions = {}): Promise<void> {
    this.browser = await chromium.launch({ headless: options.headless ?? true });
    this.context = await this.browser.newContext({
      userAgent:
        'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
      viewport: { width: 1280, height: 800 },
    });
    this.page = await this.context.newPage();
  }

  async navigate(url: string): Promise<ConsentInfo> {
    if (!this.page) throw new Error('Browser not launched. Call launch() first.');
    await this.page.goto(url, { waitUntil: 'domcontentloaded', timeout: 30000 });
    // Wait for network to settle so JS-rendered content is present
    await this.page.waitForLoadState('networkidle').catch(() => {/* timeout ok */});
    await this.page.waitForTimeout(1000);
    // Dismiss any cookie consent dialogs so they don't block the accessibility tree
    const consent = await this.dismissCookieBanners();
    await this.page.waitForTimeout(500);
    return consent;
  }

  /**
   * Attempt to dismiss common cookie consent dialogs / GDPR banners.
   * Returns ConsentInfo describing whether a banner was found and which label matched.
   */
  private async dismissCookieBanners(): Promise<ConsentInfo> {
    if (!this.page) return { found: false, buttonLabel: null };

    // Common accept button labels (ordered from most to least specific)
    const acceptLabels = [
      'Accept all',
      'Accept All',
      'Accept all cookies',
      'Accept All Cookies',
      'Allow all cookies',
      'Allow all',
      'I Accept',
      'Accept & continue',
      'Agree and proceed',
      'Agree',
      'OK',
      'Got it',
    ];

    for (const label of acceptLabels) {
      try {
        const btn = this.page.getByRole('button', { name: label, exact: false });
        const count = await btn.count();
        if (count > 0) {
          await btn.first().click({ timeout: 2000 });
          await this.page.waitForTimeout(800);
          return { found: true, buttonLabel: label };
        }
      } catch {
        // Not found or click failed, try next label
      }
    }

    return { found: false, buttonLabel: null };
  }

  /**
   * Capture the full accessibility tree via Chrome DevTools Protocol.
   * page.accessibility was removed in Playwright 1.50; CDP is the correct approach.
   */
  async captureAccessibilityTree(): Promise<RawAccessibilityNode[]> {
    if (!this.page || !this.context) throw new Error('Browser not launched. Call launch() first.');

    const client = await this.context.newCDPSession(this.page);

    try {
      const response = await client.send(
        'Accessibility.getFullAXTree',
        {},
      ) as CDPAXTreeResponse;

      const { nodes } = response;
      if (!nodes?.length) return [];

      // Build a map for parent-path traversal
      const nodeMap = new Map<string, CDPAXNode>();
      for (const node of nodes) {
        nodeMap.set(node.nodeId, node);
      }

      const result: RawAccessibilityNode[] = [];

      for (const node of nodes) {
        if (node.ignored) continue;

        const role = node.role?.value;
        if (!role || typeof role !== 'string') continue;
        if (role === 'none' || role === 'presentation' || role === 'generic') continue;

        const name = extractStringValue(node.name);
        const description = extractStringValue(node.description);
        const path = buildNodePath(node, nodeMap);
        const depth = path.split('>').length - 1;

        // Build a property map for quick lookup
        const propMap = new Map<string, string | boolean | number>();
        for (const prop of node.properties ?? []) {
          if (prop.value.value !== undefined) {
            propMap.set(prop.name, prop.value.value);
          }
        }

        const level = propMap.get('level');
        const checked = propMap.get('checked');

        result.push({
          role,
          name: name || undefined,
          description: description || undefined,
          disabled: propMap.get('disabled') === true,
          hidden: propMap.get('hidden') === true,
          checked: typeof checked === 'boolean' ? checked : undefined,
          expanded: propMap.get('expanded') === true,
          required: propMap.get('required') === true,
          level: typeof level === 'number' ? level : undefined,
          path,
          depth,
        });
      }

      return result;
    } finally {
      await client.detach();
    }
  }

  async close(): Promise<void> {
    await this.page?.close();
    await this.context?.close();
    await this.browser?.close();
    this.page = null;
    this.context = null;
    this.browser = null;
  }
}

// ─── CDP helpers ──────────────────────────────────────────────────────────────

function extractStringValue(val: CDPAXValue | undefined): string {
  if (!val) return '';
  if (typeof val.value === 'string') return val.value;
  return '';
}

/**
 * Build a readable breadcrumb path by walking up the parent chain.
 * e.g. "WebArea > banner > navigation > list > listitem > link[Study]"
 */
function buildNodePath(node: CDPAXNode, nodeMap: Map<string, CDPAXNode>): string {
  const parts: string[] = [];
  let current: CDPAXNode | undefined = node;

  while (current) {
    const role = current.role?.value;
    if (typeof role === 'string' && role !== 'none' && role !== 'presentation') {
      const name = extractStringValue(current.name);
      const label = name ? `${role}[${name.slice(0, 25)}]` : role;
      parts.unshift(label);
    }
    current = current.parentId ? nodeMap.get(current.parentId) : undefined;
    if (parts.length >= 8) break; // cap path depth at 8 parts
  }

  return parts.join(' > ') || (String(node.role?.value ?? 'unknown'));
}
