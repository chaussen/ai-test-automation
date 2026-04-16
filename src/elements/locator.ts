import type { RawAccessibilityNode, ElementEntry } from '../config/types';

/** ARIA roles that directly correspond to interactive elements */
const INTERACTIVE_ROLES = new Set([
  'button', 'link', 'textbox', 'searchbox', 'checkbox',
  'radio', 'combobox', 'listbox', 'menuitem', 'menuitemcheckbox',
  'menuitemradio', 'tab', 'switch', 'option', 'spinbutton',
  'slider', 'scrollbar',
]);

/** ARIA landmark roles — useful for structural assertions */
const LANDMARK_ROLES = new Set([
  'navigation', 'banner', 'main', 'contentinfo', 'search',
  'complementary', 'region', 'form', 'dialog',
]);

/** Heading roles — useful for content verification */
const HEADING_ROLES = new Set(['heading']);

/** Roles included in the element library */
export const INCLUDED_ROLES = new Set([
  ...INTERACTIVE_ROLES,
  ...LANDMARK_ROLES,
  ...HEADING_ROLES,
]);

/**
 * Derive a Playwright locator string from a normalised accessibility node.
 * Priority order matches Playwright's own best-practice recommendations.
 */
export function deriveLocator(node: RawAccessibilityNode): Pick<
  ElementEntry,
  'locator' | 'locatorType'
> {
  const { role, name } = node;

  // Priority 1: role + accessible name (most robust, most common)
  // .first() prevents strict-mode violations when multiple elements share the same role+name
  if (name && name.trim()) {
    return {
      locator: `page.getByRole('${role}', { name: ${JSON.stringify(name.trim())} }).first()`,
      locatorType: 'getByRole',
    };
  }

  // Priority 2: landmark/structural roles with no name (identify by role alone)
  if (LANDMARK_ROLES.has(role)) {
    return {
      locator: `page.getByRole('${role}')`,
      locatorType: 'getByRole',
    };
  }

  // Priority 3: heading with level but no accessible name captured
  if (role === 'heading') {
    return {
      locator: `page.getByRole('heading')`,
      locatorType: 'getByRole',
    };
  }

  // No reliable locator derivable
  return {
    locator: `page.getByRole('${role}')`,
    locatorType: 'getByRole',
  };
}

/**
 * Infer the page section from the node's path breadcrumb.
 * Looks for landmark roles in the ancestry.
 */
export function inferPageSection(path: string): string {
  // Check from deepest ancestor to shallowest so the most specific landmark wins.
  // e.g. "main > navigation" → 'navigation', not 'main'
  const parts = path.split('>').map((p) => p.trim().toLowerCase());
  for (let i = parts.length - 1; i >= 0; i--) {
    const part = parts[i];
    if (part.startsWith('banner')) return 'header';
    if (part.startsWith('navigation')) return 'navigation';
    if (part.startsWith('contentinfo')) return 'footer';
    if (part.startsWith('search')) return 'search';
    if (part.startsWith('main')) return 'main';
    if (part.startsWith('complementary')) return 'sidebar';
    if (part.startsWith('dialog')) return 'dialog';
  }
  return 'page';
}

/**
 * Determine whether a node should be included in the element library.
 */
export function shouldInclude(node: RawAccessibilityNode): boolean {
  if (!INCLUDED_ROLES.has(node.role)) return false;
  if (node.disabled === true) return false;
  if (node.hidden === true) return false;
  return true;
}
