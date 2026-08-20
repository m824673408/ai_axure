import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { resolve, join } from 'node:path';
import { spawnSync } from 'node:child_process';
import { afterEach, describe, expect, it } from 'vitest';
import { createFeature, initializeWorkspace } from '../src/workspace.js';
import { git } from '../src/git.js';

const roots: string[] = [];
const cli = resolve('src/cli.ts');
const tsxCli = resolve('node_modules/tsx/dist/cli.mjs');

function workspace(): string {
  const root = mkdtempSync(join(tmpdir(), 'proto-cli-'));
  roots.push(root);
  initializeWorkspace(root, true);
  return root;
}

function run(root: string, args: string[]) {
  return spawnSync(process.execPath, [tsxCli, cli, ...args], { cwd: root, encoding: 'utf8' });
}

afterEach(() => {
  for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true });
});

describe('CLI integration', () => {
  it('returns context and L005 outside a feature branch', () => {
    const root = workspace();
    const context = run(root, ['context', '--json']);
    expect(context.status).toBe(0);
    expect(JSON.parse(context.stdout).product.name).toBe('归因平台');
    const status = run(root, ['feature', 'status']);
    expect(status.status).toBe(1);
    expect(status.stderr).toContain('L005 Invalid Feature');
  });

  it('prints a reviewable semantic prompt without network access', () => {
    const root = workspace();
    createFeature(root, 'REQ-PROMPT', '语义差异');
    const result = run(root, ['diff', '--semantic', '--dry-run']);
    expect(result.status).toBe(0);
    expect(result.stdout).toContain('## Requirement');
    expect(result.stdout).toContain('REQ-PROMPT');
  });

  it('creates one immutable release tag', () => {
    const root = workspace();
    const release = run(root, ['release', '0.2.0']);
    expect(release.status).toBe(0);
    expect(git(root, ['tag', '--list', 'prototype-v0.2.0'])).toBe('prototype-v0.2.0');
    expect(git(root, ['show', 'prototype-v0.2.0:product/product.yaml'])).toContain('version: 0.2.0');
    const duplicate = run(root, ['release', '0.2.0']);
    expect(duplicate.status).toBe(1);
    expect(duplicate.stderr).toContain('不允许覆盖');
  });
});
