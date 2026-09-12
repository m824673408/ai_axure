import { appendFileSync, existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { spawnSync } from 'node:child_process';
import { afterEach, describe, expect, it } from 'vitest';
import { createFeature, initializeWorkspace } from '../src/workspace.js';

const roots: string[] = [];
const cli = resolve('src/cli.ts');
const tsxCli = resolve('node_modules/tsx/dist/cli.mjs');

function workspace(): string {
  const root = mkdtempSync(join(tmpdir(), 'proto-check-'));
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

describe('P1：proto check 合并前一次性检查', () => {
  it('在干净的 Feature 工作区通过，5 段齐全且 --no-build 时 Build 段为 SKIP', () => {
    const root = workspace();
    createFeature(root, 'REQ-CHECK-001', '检查通过');
    const result = run(root, ['check', '--no-build', '--json']);
    expect(result.status).toBe(0);
    const body = JSON.parse(result.stdout);
    expect(body.sections).toHaveLength(5);
    expect(body.sections.map((section: any) => section.id)).toEqual(['lint', 'diff', 'registry', 'build', 'risks']);
    expect(body.sections.find((section: any) => section.id === 'build').status).toBe('SKIP');
    expect(body.pass).toBe(true);
    expect(body.feature).toBe('REQ-CHECK-001');
    expect(body.base.branch).toBe('main');
  });

  it('越界改动 → Diff 段 FAIL、给出规则码与真实文件，退出码 1', () => {
    const root = workspace();
    createFeature(root, 'REQ-CHECK-002', '越界');
    // prototype 下的未授权文件 → L001；Product Model 未授权改动 → L006。两者都必须被点出。
    appendFileSync(join(root, 'prototype', 'src', 'App.tsx'), '\n// 未授权改动\n', 'utf8');
    appendFileSync(join(root, 'product', 'terminology.yaml'), '\n# 未授权改动\n', 'utf8');
    const result = run(root, ['check', '--no-build']);
    expect(result.status).toBe(1);
    expect(result.stdout).toContain('Result: FAIL');
    expect(result.stdout).toContain('L001');
    expect(result.stdout).toContain('L006');
    expect(result.stdout).toContain('prototype/src/App.tsx');
    expect(result.stdout).toContain('product/terminology.yaml');
    const diffSection = result.stdout.split('\n').find((line) => line.includes('Product Diff'));
    expect(diffSection).toContain('FAIL');
    expect(diffSection).toContain('Scope BLOCKED');
  });

  it('--out 可连续落盘 JSON，报告自身不污染检查结果', () => {
    const root = workspace();
    createFeature(root, 'REQ-CHECK-003', '落盘');
    const out = join(root, 'check-result.json');
    const result = run(root, ['check', '--no-build', '--json', '--out', out]);
    expect(result.status).toBe(0);
    expect(existsSync(out)).toBe(true);
    expect(JSON.parse(readFileSync(out, 'utf8'))).toEqual(JSON.parse(result.stdout));
    const again = run(root, ['check', '--no-build', '--json', '--out', out]);
    expect(again.status).toBe(0);
    expect(JSON.parse(readFileSync(out, 'utf8'))).toEqual(JSON.parse(again.stdout));
    expect(again.stdout).not.toContain('check-result.json');
  });

  it('--out 拒绝覆盖 Git 已跟踪文件', () => {
    const root = workspace();
    createFeature(root, 'REQ-CHECK-004', '输出保护');
    const result = run(root, ['check', '--no-build', '--out', join(root, 'product', 'product.yaml')]);
    expect(result.status).toBe(1);
    expect(result.stderr).toContain('--out 不允许覆盖 Git 已跟踪文件');
  });

  it('在基础分支上有未提交变更时：明确提示基础分支不干净，并置 baseBranchDirty=true', () => {
    const root = workspace();
    appendFileSync(join(root, 'product', 'terminology.yaml'), '\n# 直接在 main 上改\n', 'utf8');
    const result = run(root, ['check', '--no-build', '--json']);
    expect(result.status).toBe(1);
    const body = JSON.parse(result.stdout);
    expect(body.pass).toBe(false);
    expect(body.baseBranchDirty).toBe(true);
    expect(body.uncommitted).toBeGreaterThan(0);
    expect(body.branch).toBe('main');
    const text = run(root, ['check', '--no-build']);
    expect(text.status).toBe(1);
    expect(text.stdout).toContain('基础分支不干净');
    expect(text.stdout).toContain('基础分支上 Product Diff 不适用');
  });

  it('Registry 段：重复 capability_key → FAIL 且点出 L011 与两个归属（退出码 1）', () => {
    const root = workspace();
    createFeature(root, 'REQ-CHECK-005', '重复能力键');
    writeFileSync(join(root, 'components', 'registry.yaml'), [
      'components:',
      '  RuleEditorA:',
      '    description: 归因规则编辑（甲）',
      '    type: shared',
      '    capability_key: attribution_rule_edit',
      '  RuleEditorB:',
      '    description: 归因规则编辑（乙）',
      '    type: shared',
      '    capability_key: attribution_rule_edit',
      '',
    ].join('\n'), 'utf8');
    const result = run(root, ['check', '--no-build', '--json']);
    expect(result.status).toBe(1);
    const body = JSON.parse(result.stdout);
    const registrySection = body.sections.find((section: any) => section.id === 'registry');
    expect(registrySection.status).toBe('FAIL');
    expect(registrySection.detail).toContain('重复 capability_key 1 个');
    expect(registrySection.problems.join('\n')).toContain('L011');
    expect(registrySection.problems.join('\n')).toContain('RuleEditorA');
    expect(registrySection.problems.join('\n')).toContain('RuleEditorB');
    expect(body.pass).toBe(false);
  });
});
