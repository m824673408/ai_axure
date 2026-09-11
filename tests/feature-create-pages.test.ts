import { appendFileSync, existsSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { readYaml } from '../src/io.js';
import { runLint } from '../src/lint.js';
import { loadPageRegistry, registeredPathsForPage } from '../src/registry.js';
import { createFeature, initializeWorkspace } from '../src/workspace.js';

const roots: string[] = [];

function workspace(): string {
  const root = mkdtempSync(join(tmpdir(), 'proto-feature-page-'));
  roots.push(root);
  initializeWorkspace(root, true);
  return root;
}

/** 取一个"登记了真实实现文件"的页面，避免在测试里硬编码页面名。 */
function registeredPage(root: string): { pageId: string; file: string } {
  const registry = loadPageRegistry(root);
  for (const [pageId, entry] of registry.entries) {
    if (entry.file && existsSync(join(root, entry.file))) return { pageId, file: entry.file };
  }
  throw new Error('模板 Page Registry 中没有登记真实实现文件的页面');
}

function scopeOf(root: string, id: string): any {
  return readYaml(join(root, 'features', id, 'scope.yaml'));
}

afterEach(() => {
  for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true });
});

describe('P0-2 方案 A：feature create --page 经 Page Registry 自动授权', () => {
  it('把 page ID 展开为真实实现文件与 spec，写进 allowed.paths', () => {
    const root = workspace();
    const registry = loadPageRegistry(root);
    const { pageId } = registeredPage(root);

    const created = createFeature(root, 'REQ-PAGE-001', '页面授权', [pageId]);
    const scope = scopeOf(root, 'REQ-PAGE-001');

    expect(scope.allowed.pages).toEqual([pageId]);
    // 关键断言：授权里出现的是 Registry 给出的真实文件路径，而不是"按 page id 拼出来的文件名"
    for (const path of registeredPathsForPage(registry, pageId)) expect(scope.allowed.paths).toContain(path);
    expect(scope.allowed.paths).toContain('features/REQ-PAGE-001/**');
    expect(created.pages).toEqual([pageId]);
  });

  it('不传 --page 时行为与 V0.1 完全一致（pages 为空、只授权 Feature 目录）', () => {
    const root = workspace();
    createFeature(root, 'REQ-PAGE-002', '默认授权');
    const scope = scopeOf(root, 'REQ-PAGE-002');
    expect(scope.allowed.pages).toEqual([]);
    expect(scope.allowed.paths).toEqual(['features/REQ-PAGE-002/**']);
    expect(scope.allowed.product_model).toEqual([]);
    expect(scope.allowed.shared_components).toEqual([]);
  });

  it('重复的 --page 去重，且顺序稳定', () => {
    const root = workspace();
    const { pageId } = registeredPage(root);
    createFeature(root, 'REQ-PAGE-003', '去重', [pageId, pageId]);
    const scope = scopeOf(root, 'REQ-PAGE-003');
    expect(scope.allowed.pages).toEqual([pageId]);
    expect(scope.allowed.paths.filter((item: string) => item === pageId)).toHaveLength(0);
  });

  it('未知 page ID：报错并列出可选值，且不产生任何副作用（不建分支、不建目录）', () => {
    const root = workspace();
    const registry = loadPageRegistry(root);
    const candidates = [...registry.entries.keys()].sort();

    expect(() => createFeature(root, 'REQ-PAGE-004', '未知页面', ['no_such_page'])).toThrow(/未知 page ID：no_such_page/);
    expect(() => createFeature(root, 'REQ-PAGE-004', '未知页面', ['no_such_page'])).toThrow(new RegExp(candidates[0] as string));
    expect(existsSync(join(root, 'features', 'REQ-PAGE-004'))).toBe(false);
    // 分支没被创建：仍能用一个合法 ID 正常创建（说明前一次失败没有留下残留状态）
    expect(() => createFeature(root, 'REQ-PAGE-005', '后续正常', [])).not.toThrow();
  });

  it('【前后对照】带 --page 授权后直接改该页面实现文件 → 不再出现 L001', () => {
    const root = workspace();
    const { pageId, file } = registeredPage(root);
    createFeature(root, 'REQ-PAGE-006', '授权生效', [pageId]);
    appendFileSync(join(root, file), '\n// P0-2 方案 A 授权验证\n', 'utf8');

    const result = runLint(root);
    expect(result.issues.filter((issue: any) => issue.code === 'L001')).toHaveLength(0);
    expect(result.pass).toBe(true);
  });

  it('【前后对照】同一改动在不带 --page 的 Feature 上仍被 L001 拦截（证明摩擦真实存在且被方案 A 消除）', () => {
    const root = workspace();
    const { file } = registeredPage(root);
    createFeature(root, 'REQ-PAGE-007', '未授权', []);
    appendFileSync(join(root, file), '\n// 未授权改动\n', 'utf8');

    const result = runLint(root);
    const violations = result.issues.filter((issue: any) => issue.code === 'L001');
    expect(violations.length).toBeGreaterThan(0);
    expect(result.pass).toBe(false);
  });
});
