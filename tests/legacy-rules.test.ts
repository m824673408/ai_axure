import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { git } from '../src/git.js';
import { runLint } from '../src/lint.js';
import { initializeWorkspace } from '../src/workspace.js';
import { patch } from './helpers.js';

/**
 * §10.3 回归：V0.1 已有的 L001–L006 行为不得退化。
 * 这里覆盖 P0 阶段未直接断言的旧规则（L002 路由重复、L003 导航引用缺失、L005 非 Feature 分支），
 * 以及 `.proto.llm.yaml` 必须继续被 Git 忽略。
 */

const roots: string[] = [];

function workspace(): string {
  const root = mkdtempSync(join(tmpdir(), 'proto-legacy-'));
  roots.push(root);
  initializeWorkspace(root, true);
  return root;
}

afterEach(() => {
  for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true });
});

describe('§10.3 既有规则回归', () => {
  it('L002：两条 route 使用同一 path 时仍然 BLOCK', () => {
    const root = workspace();
    const routes = readFileSync(join(root, 'product', 'routes.yaml'), 'utf8');
    // 从真实内容取锚点：把 dashboard 的 path 改成与 attribution_rule 相同
    const target = routes.match(/attribution_rule:\s*\n\s*path:\s*(\S+)/)?.[1];
    const current = routes.match(/dashboard:\s*\n\s*path:\s*(\S+)/)?.[1];
    expect(target, '模板 routes.yaml 应包含 attribution_rule 的 path').toBeTruthy();
    expect(current, '模板 routes.yaml 应包含 dashboard 的 path').toBeTruthy();
    patch(root, join('product', 'routes.yaml'), `path: ${current as string}`, `path: ${target as string}`);
    const issues = runLint(root).issues;
    expect(issues.some((issue) => issue.code === 'L002' && issue.file === 'product/routes.yaml'), JSON.stringify(issues)).toBe(true);
  });

  it('L003：navigation 引用了不存在的 route 时仍然 BLOCK', () => {
    const root = workspace();
    const navigation = readFileSync(join(root, 'product', 'navigation.yaml'), 'utf8');
    const firstPage = navigation.match(/page:\s*(\S+)/)?.[1] ?? 'dashboard';
    patch(root, join('product', 'navigation.yaml'), `page: ${firstPage}`, 'page: ghost_route_page');
    const issues = runLint(root).issues;
    expect(issues.some((issue) => issue.code === 'L003' && issue.file === 'product/navigation.yaml'), JSON.stringify(issues)).toBe(true);
  });

  it('L005：非 feature 分支上 feature status 语义不变（currentFeature 为 null）', () => {
    const root = workspace();
    expect(existsSync(join(root, '.git'))).toBe(true);
    expect(git(root, ['branch', '--show-current'])).toBe('main');
    const result = runLint(root);
    // main 分支不产生 Scope 检查，也不应因缺少 Feature 而报错
    expect(result.feature).toBeNull();
    expect(result.checks).not.toContain('Feature scope');
  });

  it('.proto.llm.yaml 继续被 Git 忽略（不得提交密钥）', () => {
    const root = workspace();
    writeFileSync(join(root, '.proto.llm.yaml'), 'baseUrl: https://example.invalid/v1\napiKey: secret\nmodel: x\n', 'utf8');
    const ignored = git(root, ['check-ignore', '-v', '.proto.llm.yaml'], true);
    expect(ignored).toContain('.proto.llm.yaml');
    expect(git(root, ['status', '--porcelain']).includes('.proto.llm.yaml')).toBe(false);
  });
});
