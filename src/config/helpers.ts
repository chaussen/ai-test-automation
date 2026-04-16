import type { Role, TestSuite } from './types';

/**
 * Define and validate an array of user roles.
 * Throws a descriptive error if any validation fails.
 */
export function defineRoles(roles: Role[]): Role[] {
  if (!Array.isArray(roles) || roles.length === 0) {
    throw new Error('[config] defineRoles: must provide at least one role');
  }
  const names = new Set<string>();
  for (const role of roles) {
    if (!role.name || typeof role.name !== 'string') {
      throw new Error('[config] defineRoles: every role must have a non-empty name');
    }
    if (names.has(role.name)) {
      throw new Error(`[config] defineRoles: duplicate role name "${role.name}"`);
    }
    names.add(role.name);
    if (role.credentials) {
      if (!role.credentials.email || !role.credentials.password) {
        throw new Error(`[config] Role "${role.name}": credentials must have non-empty email and password`);
      }
    }
    if (!role.attributes || typeof role.attributes !== 'object') {
      throw new Error(`[config] Role "${role.name}": attributes must be a plain object`);
    }
  }
  return roles;
}

/**
 * Define and validate an array of test suites.
 * Throws a descriptive error if any validation fails.
 */
export function defineTests(suites: TestSuite[]): TestSuite[] {
  if (!Array.isArray(suites) || suites.length === 0) {
    throw new Error('[config] defineTests: must provide at least one test suite');
  }
  for (const suite of suites) {
    if (!suite.name) {
      throw new Error('[config] defineTests: every suite must have a non-empty name');
    }
    if (!suite.url) {
      throw new Error(`[config] Suite "${suite.name}": url is required`);
    }
    try {
      new URL(suite.url);
    } catch {
      throw new Error(`[config] Suite "${suite.name}": invalid URL "${suite.url}"`);
    }
    if (!Array.isArray(suite.steps) || suite.steps.length === 0) {
      throw new Error(`[config] Suite "${suite.name}": must have at least one step`);
    }
    for (const step of suite.steps) {
      if (!step || typeof step !== 'string') {
        throw new Error(`[config] Suite "${suite.name}": all steps must be non-empty strings`);
      }
    }
    if (!Array.isArray(suite.roles)) {
      throw new Error(`[config] Suite "${suite.name}": roles must be an array (can be empty for public access)`);
    }
  }
  return suites;
}
