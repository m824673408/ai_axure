import { appendFileSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { previewEnvironment } from '../src/preview.js';
import { freezeScope } from '../src/scope-lock.js';
import { createFeature, initializeWorkspace } from '../src/workspace.js';

const roots: string[] = [];

afterEach(() => {
  for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true });
});

describe('Preview runtime context', () => {
  it('injects the current Feature identity, scope, and lint snapshot', () => {
    const root = mkdtempSync(join(tmpdir(), 'proto-preview-context-'));
    roots.push(root);
    initializeWorkspace(root, true);
    createFeature(root, 'REQ-PREVIEW-001', '动态预览', ['attribution_rule']);
    freezeScope(root, 'REQ-PREVIEW-001');

    const env = previewEnvironment(root, {});
    expect(env.VITE_PROTO_BRANCH).toBe('feature/REQ-PREVIEW-001');
    expect(env.VITE_PROTO_FEATURE_ID).toBe('REQ-PREVIEW-001');
    expect(env.VITE_PROTO_FEATURE_NAME).toBe('动态预览');
    expect(env.VITE_PROTO_ALLOWED_PAGES).toBe('attribution_rule');
    expect(env.VITE_PROTO_LINT_STATUS).toBe('PASS');

    appendFileSync(join(root, 'prototype', 'src', 'pages', 'MediaConfigPage.tsx'), '\n// 越界\n', 'utf8');
    expect(previewEnvironment(root, {}).VITE_PROTO_LINT_STATUS).toBe('BLOCKED');
  });
});
