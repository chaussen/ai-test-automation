import crypto from 'crypto';
import type { RawAccessibilityNode, ElementLibrary, ElementEntry, ConsentInfo } from '../config/types';
import { deriveLocator, inferPageSection, shouldInclude } from './locator';

/** Maximum number of elements to include in the library sent to the LLM */
const MAX_ELEMENTS = 120;

/**
 * Build an ElementLibrary from a flat array of raw accessibility nodes.
 * Filters to relevant roles, derives locators, deduplicates, and caps count.
 */
export function buildElementLibrary(
  nodes: RawAccessibilityNode[],
  url: string,
  consentInfo: ConsentInfo = { found: false, buttonLabel: null },
): ElementLibrary {
  const urlHash = sha256(url).slice(0, 12);

  // 1. Filter to included roles
  const filtered = nodes.filter(shouldInclude);

  // 2. Deduplicate: same (role, name) pair appearing more than 3 times is noise
  //    (e.g. dozens of "Read more" links). Keep first 3 occurrences per pair.
  const pairCount = new Map<string, number>();
  const deduped: RawAccessibilityNode[] = [];
  for (const node of filtered) {
    const key = `${node.role}::${(node.name ?? '').trim().toLowerCase()}`;
    const count = pairCount.get(key) ?? 0;
    if (count < 3) {
      deduped.push(node);
      pairCount.set(key, count + 1);
    }
  }

  // 3. Sort: landmarks first, then interactive, then headings — by depth ascending
  const sorted = deduped.sort((a, b) => {
    const rankA = roleRank(a.role);
    const rankB = roleRank(b.role);
    if (rankA !== rankB) return rankA - rankB;
    return a.depth - b.depth;
  });

  // 4. Cap
  const capped = sorted.slice(0, MAX_ELEMENTS);

  // 5. Build ElementEntry for each
  const elements: ElementEntry[] = capped.map((node) => {
    const { locator, locatorType } = deriveLocator(node);
    const id = sha256(`${node.role}::${node.name ?? ''}::${node.path}`).slice(0, 16);
    const pageSection = inferPageSection(node.path);
    const description = buildDescription(node, pageSection);

    return {
      id,
      role: node.role,
      name: node.name ?? '',
      description,
      locator,
      locatorType,
      pageSection,
    };
  });

  const hash = sha256(JSON.stringify(elements)).slice(0, 16);

  return {
    url,
    urlHash,
    capturedAt: new Date().toISOString(),
    hash,
    totalRawNodes: nodes.length,
    elements,
    consentInfo,
  };
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

function sha256(input: string): string {
  return crypto.createHash('sha256').update(input).digest('hex');
}

function roleRank(role: string): number {
  if (['banner', 'navigation', 'main', 'contentinfo', 'search'].includes(role)) return 0;
  if (['button', 'link', 'textbox', 'searchbox', 'combobox'].includes(role)) return 1;
  if (role === 'heading') return 2;
  return 3;
}

function buildDescription(node: RawAccessibilityNode, section: string): string {
  const namePart = node.name ? `"${node.name.slice(0, 60)}"` : '(no label)';
  const sectionPart = section !== 'page' ? ` in the ${section}` : '';

  switch (node.role) {
    case 'link':        return `Link ${namePart}${sectionPart}`;
    case 'button':      return `Button ${namePart}${sectionPart}`;
    case 'textbox':     return `Text input ${namePart}${sectionPart}`;
    case 'searchbox':   return `Search input${sectionPart}`;
    case 'heading':     return `Heading ${namePart} (level ${node.level ?? '?'})${sectionPart}`;
    case 'navigation':  return `Navigation landmark${node.name ? ` "${node.name}"` : ''}`;
    case 'banner':      return `Page header / banner`;
    case 'main':        return `Main content area`;
    case 'contentinfo': return `Page footer`;
    case 'search':      return `Search landmark`;
    case 'checkbox':    return `Checkbox ${namePart}${sectionPart}`;
    case 'combobox':    return `Dropdown / combobox ${namePart}${sectionPart}`;
    default:            return `${node.role} ${namePart}${sectionPart}`;
  }
}
