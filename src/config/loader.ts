import path from 'path';
import { pathToFileURL } from 'url';
import type { Role, TestSuite } from './types';

/**
 * Dynamically import a user-authored TypeScript config file.
 * Works because tsx registers a TypeScript loader for the process.
 */
async function importTsFile(filePath: string): Promise<{ default: unknown }> {
  const absPath = path.resolve(process.cwd(), filePath);
  // Use pathToFileURL for cross-platform compatibility
  const fileUrl = pathToFileURL(absPath).href;
  return import(fileUrl);
}

export async function loadRoles(filePath: string): Promise<Role[]> {
  const mod = await importTsFile(filePath);
  if (!Array.isArray(mod.default)) {
    throw new Error(`[loader] "${filePath}" must export a default array of roles`);
  }
  return mod.default as Role[];
}

export async function loadSuites(filePath: string): Promise<TestSuite[]> {
  const mod = await importTsFile(filePath);
  if (!Array.isArray(mod.default)) {
    throw new Error(`[loader] "${filePath}" must export a default array of test suites`);
  }
  return mod.default as TestSuite[];
}
