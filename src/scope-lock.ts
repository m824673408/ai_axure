import { createHash } from 'node:crypto';
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { z } from 'zod';
import { ProtoError } from './errors.js';
import { knownProductModelKeys, scopeReferenceIssues } from './lint-rules.js';
import { loadComponentRegistry, loadPageRegistry } from './registry.js';
import { checkComponentRegistrySchema, checkNavigationSchema, checkProductSchema, checkScopeSchema } from './schema.js';
import { readYaml } from './io.js';
import { loadNavigation, loadScope } from './workspace.js';
import type { NavigationItem } from './types.js';

export const SCOPE_LOCK_CONTRACT_VERSION = '1';

const lockSchema = z.object({
  contractVersion: z.literal(SCOPE_LOCK_CONTRACT_VERSION),
  featureId: z.string().min(1),
  scopeDigest: z.string().regex(/^sha256:[0-9a-f]{64}$/),
}).strict();

export type ScopeLockState = 'LOCKED' | 'MISSING' | 'STALE';
export interface ScopeLockStatus {
  status: ScopeLockState;
  featureId: string;
  currentDigest: string | null;
  lockedDigest: string | null;
  reason: string | null;
  lockFile: string;
}

function canonicalize(value: unknown): unknown {
  if (Array.isArray(value)) {
    return value.map(canonicalize).sort((a, b) => JSON.stringify(a).localeCompare(JSON.stringify(b)));
  }
  if (value && typeof value === 'object') {
    return Object.fromEntries(Object.entries(value as Record<string, unknown>)
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([key, item]) => [key, canonicalize(item)]));
  }
  return value;
}

export function scopeDigest(value: unknown): string {
  return `sha256:${createHash('sha256').update(JSON.stringify(canonicalize(value))).digest('hex')}`;
}

export function currentScopeDigest(root: string, featureId: string): string {
  return scopeDigest(readYaml<unknown>(join(root, 'features', featureId, 'scope.yaml')));
}

export function scopeLockStatus(root: string, featureId: string): ScopeLockStatus {
  const lockFile = `features/${featureId}/scope.lock.json`;
  let currentDigest: string | null = null;
  try {
    currentDigest = currentScopeDigest(root, featureId);
  } catch (error) {
    return { status: 'STALE', featureId, currentDigest: null, lockedDigest: null, reason: error instanceof Error ? error.message : String(error), lockFile };
  }
  const full = join(root, lockFile);
  if (!existsSync(full)) return { status: 'MISSING', featureId, currentDigest, lockedDigest: null, reason: 'Scope 尚未冻结。', lockFile };
  try {
    const lock = lockSchema.parse(JSON.parse(readFileSync(full, 'utf8')));
    if (lock.featureId !== featureId) return { status: 'STALE', featureId, currentDigest, lockedDigest: lock.scopeDigest, reason: `锁文件 Feature 为 ${lock.featureId}，与当前 ${featureId} 不匹配。`, lockFile };
    if (lock.scopeDigest !== currentDigest) return { status: 'STALE', featureId, currentDigest, lockedDigest: lock.scopeDigest, reason: 'Scope 语义已改变，需要重新冻结。', lockFile };
    return { status: 'LOCKED', featureId, currentDigest, lockedDigest: lock.scopeDigest, reason: null, lockFile };
  } catch (error) {
    return { status: 'STALE', featureId, currentDigest, lockedDigest: null, reason: `锁文件无效：${error instanceof Error ? error.message : String(error)}`, lockFile };
  }
}

function flattenPages(items: NavigationItem[]): string[] {
  return items.flatMap((item) => [item.page, ...flattenPages(item.children ?? [])].filter((value): value is string => Boolean(value)));
}

export function freezeScope(root: string, featureId: string): ScopeLockStatus {
  const schema = checkScopeSchema(root, featureId);
  if (schema.issues.length > 0) throw new ProtoError(`Scope 无法冻结：\n${schema.issues.map((issue) => `${issue.field ?? issue.file ?? 'scope'}: ${issue.message}`).join('\n')}`);
  const scope = loadScope(root, featureId);
  if (!scope) throw new ProtoError(`Scope 不存在：${featureId}`);
  const product = checkProductSchema(root);
  const navigation = checkNavigationSchema(root);
  const components = checkComponentRegistrySchema(root);
  const pages = loadPageRegistry(root);
  const invalid = scopeReferenceIssues(featureId, scope, {
    knownPages: new Set([...flattenPages(loadNavigation(root)), ...pages.entries.keys()]),
    knownComponents: components.componentIds,
    knownProductModel: knownProductModelKeys(root),
  });
  const contextIssues = [...product.issues, ...navigation.issues, ...components.issues, ...invalid];
  if (contextIssues.length > 0) throw new ProtoError(`Scope 无法冻结：\n${contextIssues.map((issue) => `${issue.field ?? issue.file ?? 'scope'}: ${issue.message}`).join('\n')}`);
  const digest = currentScopeDigest(root, featureId);
  const lock = { contractVersion: SCOPE_LOCK_CONTRACT_VERSION, featureId, scopeDigest: digest };
  writeFileSync(join(root, 'features', featureId, 'scope.lock.json'), `${JSON.stringify(lock, null, 2)}\n`, 'utf8');
  return scopeLockStatus(root, featureId);
}
