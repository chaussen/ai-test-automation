import fs from 'fs/promises';
import path from 'path';
import crypto from 'crypto';

const INDEX_PATH = '.ata/scripts/index.json';

interface CacheEntry {
  path: string;
  createdAt: string;
  lastRunAt: string | null;
  lastRunStatus: 'passed' | 'failed' | 'stale' | null;
  url: string;
  stepCount: number;
  pageHash: string | null;  // element library hash at generation time
}

type CacheIndex = Record<string, CacheEntry>;

export function computeScriptHash(url: string, steps: string[]): string {
  const input = `${url}::${steps.join('|')}`;
  return crypto.createHash('sha256').update(input).digest('hex').slice(0, 20);
}

async function readIndex(): Promise<CacheIndex> {
  try {
    const raw = await fs.readFile(INDEX_PATH, 'utf8');
    return JSON.parse(raw) as CacheIndex;
  } catch {
    return {};
  }
}

async function writeIndex(index: CacheIndex): Promise<void> {
  await fs.mkdir(path.dirname(INDEX_PATH), { recursive: true });
  await fs.writeFile(INDEX_PATH, JSON.stringify(index, null, 2), 'utf8');
}

/** Returns the cached script path if it exists, previously passed, and the page hasn't changed. */
export async function getCachedScript(hash: string, currentPageHash?: string): Promise<string | null> {
  const index = await readIndex();
  const entry = index[hash];
  if (!entry) return null;
  // Only use cache if the last run passed and isn't stale
  if (entry.lastRunStatus !== 'passed') return null;
  // If we have a current page hash and it differs from when the script was generated, invalidate
  if (currentPageHash && entry.pageHash && entry.pageHash !== currentPageHash) return null;
  // Verify file still exists
  try {
    await fs.access(entry.path);
    return entry.path;
  } catch {
    return null;
  }
}

/** Record a newly generated script in the cache index. */
export async function recordScript(
  hash: string,
  scriptPath: string,
  url: string,
  stepCount: number,
  pageHash?: string,
): Promise<void> {
  const index = await readIndex();
  index[hash] = {
    path: scriptPath,
    createdAt: new Date().toISOString(),
    lastRunAt: null,
    lastRunStatus: null,
    url,
    stepCount,
    pageHash: pageHash ?? null,
  };
  await writeIndex(index);
}

/**
 * Mark all passed scripts for a given URL as stale.
 * Called when element library diff detects a page change.
 * Returns the number of entries invalidated.
 */
export async function invalidateScriptsForUrl(url: string): Promise<number> {
  const index = await readIndex();
  let count = 0;
  for (const entry of Object.values(index)) {
    if (entry.url === url && entry.lastRunStatus === 'passed') {
      entry.lastRunStatus = 'stale';
      count++;
    }
  }
  if (count > 0) await writeIndex(index);
  return count;
}

/** Update the last run result in the cache index. */
export async function updateRunResult(
  hash: string,
  status: 'passed' | 'failed',
): Promise<void> {
  const index = await readIndex();
  if (index[hash]) {
    index[hash].lastRunAt = new Date().toISOString();
    index[hash].lastRunStatus = status;
    await writeIndex(index);
  }
}
