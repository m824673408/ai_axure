import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { createDiff } from '../src/diff.js';
import { currentBranch, git } from '../src/git.js';
import { runLint } from '../src/lint.js';
import { createFeature, initializeWorkspace, loadProduct } from '../src/workspace.js';

const roots: string[] = [];
function workspace(): string {
  const root = mkdtempSync(join(tmpdir(), 'proto-workspace-'));
  roots.push(root);
  initializeWorkspace(root, true);
  return root;
}

afterEach(() => {
  for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true });
});

describe('workspace lifecycle', () => {
  it('initializes a complete clean workspace on main', () => {
    const root = workspace();
    expect(loadProduct(root).product.name).toBe('归因平台');
    expect(currentBranch(root)).toBe('main');
    expect(git(root, ['status', '--porcelain'])).toBe('');
    expect(runLint(root).pass).toBe(true);
    expect(existsSync(join(root, '.proto.llm.example.yaml'))).toBe(true);
    expect(readFileSync(join(root, '.gitignore'), 'utf8')).toContain('.proto.llm.yaml');
  });

  it('creates a feature branch and scaffold', () => {
    const root = workspace();
    createFeature(root, 'REQ-001', '规则历史版本');
    expect(currentBranch(root)).toBe('feature/REQ-001');
    expect(readFileSync(join(root, 'features', 'REQ-001', 'scope.yaml'), 'utf8')).toContain('REQ-001');
    expect(runLint(root).pass).toBe(true);
    expect(createDiff(root).featureFiles).toHaveLength(4);
  });

  it('blocks scope and product model violations', () => {
    const root = workspace();
    createFeature(root, 'REQ-002', '越界检查');
    writeFileSync(join(root, 'product', 'navigation.yaml'), `${readFileSync(join(root, 'product', 'navigation.yaml'), 'utf8')}\n# unauthorized\n`, 'utf8');
    writeFileSync(join(root, 'README.md'), `${readFileSync(join(root, 'README.md'), 'utf8')}\n越界\n`, 'utf8');
    const result = runLint(root);
    expect(result.pass).toBe(false);
    expect(result.issues.some((issue) => issue.code === 'L006')).toBe(true);
    expect(result.issues.some((issue) => issue.code === 'L001')).toBe(true);
  });

  it('detects duplicate and missing routes', () => {
    const root = workspace();
    const routes = join(root, 'product', 'routes.yaml');
    writeFileSync(routes, `routes:\n  dashboard:\n    path: /\n    module: overview\n  attribution_rule:\n    path: /\n    module: attribution\n`, 'utf8');
    const result = runLint(root);
    expect(result.issues.some((issue) => issue.code === 'L002')).toBe(true);
    expect(result.issues.some((issue) => issue.code === 'L003')).toBe(true);
  });

  it('blocks unregistered and unauthorized shared components', () => {
    const root = workspace();
    createFeature(root, 'REQ-003', '公共组件越界');
    const file = join(root, 'prototype', 'src', 'components', 'shared', 'NewShared.tsx');
    writeFileSync(file, 'export const NewShared = () => null;\n', 'utf8');
    const result = runLint(root);
    expect(result.issues.some((issue) => issue.code === 'L004')).toBe(true);
    expect(result.issues.some((issue) => issue.code === 'L001')).toBe(true);
  });

  it('supports independent PM feature workspaces', () => {
    const a = workspace();
    const b = workspace();
    createFeature(a, 'REQ-PM-A', '归因规则调整');
    createFeature(b, 'REQ-PM-B', '媒体配置调整');
    expect(currentBranch(a)).toBe('feature/REQ-PM-A');
    expect(currentBranch(b)).toBe('feature/REQ-PM-B');
    expect(runLint(a).pass).toBe(true);
    expect(runLint(b).pass).toBe(true);
  });
});
