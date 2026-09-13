import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { runLint } from '../src/lint.js';
import { freezeScope, scopeDigest, scopeLockStatus } from '../src/scope-lock.js';
import { createFeature, initializeWorkspace } from '../src/workspace.js';

const roots: string[] = [];
function workspace(): string {
  const root = mkdtempSync(join(tmpdir(), 'proto-scope-lock-'));
  roots.push(root);
  initializeWorkspace(root, true);
  createFeature(root, 'REQ-LOCK-001', '范围冻结');
  return root;
}

afterEach(() => {
  for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true });
});

describe('Scope lock', () => {
  it('对象键、数组顺序与 CRLF/LF 不影响摘要，重复项仍参与摘要', () => {
    const a = { feature: { id: 'REQ-X', name: 'X' }, allowed: { pages: ['b', 'a'], paths: ['z', 'z'], product_model: [], shared_components: [] }, forbidden: ['q'] };
    const b = { forbidden: ['q'], allowed: { shared_components: [], product_model: [], paths: ['z', 'z'], pages: ['a', 'b'] }, feature: { name: 'X', id: 'REQ-X' } };
    const withoutDuplicate = { ...b, allowed: { ...b.allowed, paths: ['z'] } };
    expect(scopeDigest(a)).toBe(scopeDigest(b));
    expect(scopeDigest(a)).not.toBe(scopeDigest(withoutDuplicate));
    expect(scopeDigest('a\r\nb')).not.toBe(scopeDigest('a\nb'));
  });

  it('MISSING → LOCKED → STALE，lint 用 L014 确定性 BLOCK', () => {
    const root = workspace();
    expect(scopeLockStatus(root, 'REQ-LOCK-001').status).toBe('MISSING');
    let lint = runLint(root);
    expect(lint.pass).toBe(false);
    expect(lint.issues.some((issue) => issue.code === 'L014')).toBe(true);
    const frozen = freezeScope(root, 'REQ-LOCK-001');
    expect(frozen.status).toBe('LOCKED');
    expect(frozen.currentDigest).toBe(frozen.lockedDigest);
    expect(runLint(root).issues.some((issue) => issue.code === 'L014')).toBe(false);
    const scopePath = join(root, 'features', 'REQ-LOCK-001', 'scope.yaml');
    const source = readFileSync(scopePath, 'utf8');
    writeFileSync(scopePath, source.replace('  pages: []', '  pages:\n    - attribution_rule'), 'utf8');
    expect(scopeLockStatus(root, 'REQ-LOCK-001').status).toBe('STALE');
    lint = runLint(root);
    expect(lint.issues.some((issue) => issue.code === 'L014' && issue.file === 'features/REQ-LOCK-001/scope.lock.json')).toBe(true);
  });

  it('仅换行与 YAML 排版不使锁过期', () => {
    const root = workspace();
    freezeScope(root, 'REQ-LOCK-001');
    const scopePath = join(root, 'features', 'REQ-LOCK-001', 'scope.yaml');
    const source = readFileSync(scopePath, 'utf8');
    writeFileSync(scopePath, source.replaceAll('\n', '\r\n').replace('pages: []', 'pages: [ ]'), 'utf8');
    expect(scopeLockStatus(root, 'REQ-LOCK-001').status).toBe('LOCKED');
  });

  it('非法 Scope、Feature 不匹配和损坏锁均不能伪装成 LOCKED', () => {
    const root = workspace();
    const scopePath = join(root, 'features', 'REQ-LOCK-001', 'scope.yaml');
    writeFileSync(scopePath, 'feature:\n  id: REQ-LOCK-001\n', 'utf8');
    expect(() => freezeScope(root, 'REQ-LOCK-001')).toThrow(/Scope 无法冻结/);
    writeFileSync(scopePath, `feature:\n  id: REQ-LOCK-001\n  name: 范围冻结\nallowed:\n  pages: []\n  shared_components: []\n  product_model: []\n  paths:\n    - features/REQ-LOCK-001/**\nforbidden: []\n`, 'utf8');
    freezeScope(root, 'REQ-LOCK-001');
    const lockPath = join(root, 'features', 'REQ-LOCK-001', 'scope.lock.json');
    const lock = JSON.parse(readFileSync(lockPath, 'utf8'));
    writeFileSync(lockPath, JSON.stringify({ ...lock, featureId: 'REQ-OTHER' }), 'utf8');
    expect(scopeLockStatus(root, 'REQ-LOCK-001').status).toBe('STALE');
    writeFileSync(lockPath, JSON.stringify({ ...lock, scopeDigest: 'sha256:not-valid' }), 'utf8');
    expect(scopeLockStatus(root, 'REQ-LOCK-001').status).toBe('STALE');
  });
});
