import type { ElementLibrary, ElementEntry } from '../config/types';

export interface LibraryDiff {
  changed: boolean;
  added: ElementEntry[];
  removed: ElementEntry[];
  summary: string;
}

/**
 * Diff two element libraries by element ID.
 * IDs are stable (SHA-256 of role::name::path) so reordering doesn't count as a change.
 */
export function diffLibraries(
  oldLib: ElementLibrary,
  newLib: ElementLibrary,
): LibraryDiff {
  // Fast path: same content hash → nothing changed
  if (oldLib.hash === newLib.hash) {
    return { changed: false, added: [], removed: [], summary: 'unchanged' };
  }

  const oldIds = new Set(oldLib.elements.map((e) => e.id));
  const newIds = new Set(newLib.elements.map((e) => e.id));

  const added = newLib.elements.filter((e) => !oldIds.has(e.id));
  const removed = oldLib.elements.filter((e) => !newIds.has(e.id));
  const changed = added.length > 0 || removed.length > 0;

  const parts: string[] = [];
  if (added.length) parts.push(`+${added.length} added`);
  if (removed.length) parts.push(`-${removed.length} removed`);
  const summary = changed ? parts.join(', ') : 'hash changed but elements identical';

  return { changed, added, removed, summary };
}
