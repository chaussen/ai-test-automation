import fs from 'fs/promises';
import path from 'path';
import type { ElementLibrary } from '../config/types';

const CACHE_DIR = '.ata/element-libraries';

export async function saveElementLibrary(library: ElementLibrary): Promise<string> {
  const dir = path.join(CACHE_DIR, library.urlHash);
  await fs.mkdir(dir, { recursive: true });
  const filePath = path.join(dir, 'library.json');
  await fs.writeFile(filePath, JSON.stringify(library, null, 2), 'utf8');
  return filePath;
}

export async function loadElementLibrary(
  urlHash: string,
): Promise<ElementLibrary | null> {
  const filePath = path.join(CACHE_DIR, urlHash, 'library.json');
  try {
    const raw = await fs.readFile(filePath, 'utf8');
    return JSON.parse(raw) as ElementLibrary;
  } catch {
    return null;
  }
}
