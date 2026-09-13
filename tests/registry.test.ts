import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { runLint } from '../src/lint.js';
import { loadPageRegistry } from '../src/registry.js';
import { authorizePath } from '../src/scope.js';
import { freezeScope } from '../src/scope-lock.js';
import { createFeature, initializeWorkspace, loadScope } from '../src/workspace.js';
import { appendText as append, patch } from './helpers.js';

const roots: string[] = [];

function workspace(): string {
  const root = mkdtempSync(join(tmpdir(), 'proto-registry-'));
  roots.push(root);
  initializeWorkspace(root, true);
  return root;
}

afterEach(() => {
  for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true });
});

const SCOPE_WITH_PAGE = `feature:
  id: REQ-001
  name: 归因规则版本对比

allowed:
  pages:
    - attribution_rule
  shared_components: []
  product_model: []
  paths:
    - features/REQ-001/**

forbidden:
  - product/terminology.yaml
`;

function featureWithPageScope(root: string): void {
  createFeature(root, 'REQ-001', '归因规则版本对比');
  writeFileSync(join(root, 'features', 'REQ-001', 'scope.yaml'), SCOPE_WITH_PAGE, 'utf8');
  freezeScope(root, 'REQ-001');
}

describe('P0-3 page / component registry', () => {
  it('模板工作区自带 Page Registry 且通过校验', () => {
    const root = workspace();
    const registry = loadPageRegistry(root);
    expect(registry.present).toBe(true);
    expect(registry.entries.get('attribution_rule')?.file).toBe('prototype/src/pages/AttributionRulesPage.tsx');
    const result = runLint(root);
    expect(result.pass, JSON.stringify(result.issues)).toBe(true);
    expect(result.checks).toContain('Schema: Page Registry');
    expect(result.checks).toContain('Capability keys');
  });

  it('Page Registry 缺失时行为与 V0.1 完全一致（兼容性）', () => {
    const root = workspace();
    rmSync(join(root, 'product', 'pages.yaml'));
    expect(loadPageRegistry(root).present).toBe(false);
    expect(runLint(root).pass).toBe(true);
  });

  it('file 指向不存在的实现文件 → L010', () => {
    const root = workspace();
    patch(root, join('product', 'pages.yaml'), 'file: prototype/src/pages/DashboardPage.tsx', 'file: prototype/src/pages/NotTherePage.tsx');
    const result = runLint(root);
    const issue = result.issues.find((item) => item.code === 'L010');
    expect(issue?.field).toBe('pages.dashboard.file');
    expect(issue?.fix && issue.fix.length).toBeGreaterThan(0);
  });

  it('spec 指向不存在的文件 → L010', () => {
    const root = workspace();
    patch(root, join('product', 'pages.yaml'), 'spec: specs/attribution_rule.md', 'spec: specs/not_there.md');
    const result = runLint(root);
    expect(result.issues.some((item) => item.code === 'L010' && item.field === 'pages.attribution_rule.spec')).toBe(true);
  });

  it('两个页面登记同一实现文件 → L008', () => {
    const root = workspace();
    patch(root, join('product', 'pages.yaml'), 'file: prototype/src/pages/MediaConfigPage.tsx', 'file: prototype/src/pages/DashboardPage.tsx');
    const result = runLint(root);
    expect(result.issues.some((item) => item.code === 'L008' && item.message.includes('DashboardPage.tsx'))).toBe(true);
  });

  it('route / module / layout 引用不存在 → L009', () => {
    const root = workspace();
    patch(root, join('product', 'pages.yaml'), 'route: media_config', 'route: not_a_route');
    patch(root, join('product', 'pages.yaml'), 'module: media', 'module: not_a_module');
    patch(root, join('product', 'pages.yaml'), 'route: dashboard', 'route: dashboard\n    layout: NotRegistered');
    const result = runLint(root);
    const codes = result.issues.filter((item) => item.code === 'L009').map((item) => item.field);
    expect(codes).toContain('pages.media_config.route');
    expect(codes).toContain('pages.media_config.module');
    expect(codes).toContain('pages.dashboard.layout');
  });

  it('两个组件声明同一 capability_key → L011 BLOCK', () => {
    const root = workspace();
    patch(root, join('components', 'registry.yaml'), '  SearchForm:\n    description: 响应式查询条件容器', '  SearchForm:\n    capability_key: query-form\n    description: 响应式查询条件容器');
    patch(root, join('components', 'registry.yaml'), '  MediaSelector:\n    description: 媒体筛选组件', '  MediaSelector:\n    capability_key: query-form\n    description: 媒体筛选组件');
    const result = runLint(root);
    const issue = result.issues.find((item) => item.code === 'L011');
    expect(issue).toBeDefined();
    expect(issue?.message).toContain('query-form');
    expect(issue?.message).toContain('SearchForm');
    expect(issue?.message).toContain('MediaSelector');
  });

  it('新增共享组件未登记仍然 BLOCK（L004 回归）', () => {
    const root = workspace();
    createFeature(root, 'REQ-002', '新增公共组件');
    writeFileSync(join(root, 'prototype', 'src', 'components', 'shared', 'BrandNewWidget.tsx'), 'export function BrandNewWidget() { return null; }\n', 'utf8');
    const result = runLint(root);
    expect(result.issues.some((item) => item.code === 'L004')).toBe(true);
  });

  it('【核心】Registry 让 allowed.pages 直接授权真实实现文件（消除 P0-2 摩擦）', () => {
    const root = workspace();
    featureWithPageScope(root);
    append(root, join('prototype', 'src', 'pages', 'AttributionRulesPage.tsx'), '// feature 改动');
    const result = runLint(root);
    expect(result.issues.filter((item) => item.code === 'L001'), JSON.stringify(result.issues)).toHaveLength(0);
    expect(result.pass, JSON.stringify(result.issues)).toBe(true);
  });

  it('【前后对照】同一 Scope 在删除 Registry 后被 L001 BLOCK（证明摩擦真实存在且被 Registry 消除）', () => {
    const root = workspace();
    featureWithPageScope(root);
    append(root, join('prototype', 'src', 'pages', 'AttributionRulesPage.tsx'), '// feature 改动');
    rmSync(join(root, 'product', 'pages.yaml'));
    const result = runLint(root);
    const violation = result.issues.find((item) => item.code === 'L001');
    expect(violation?.file).toBe('prototype/src/pages/AttributionRulesPage.tsx');
  });

  it('未登记在 Scope 里的页面文件仍被 L001 拦截（不得过度授权）', () => {
    const root = workspace();
    featureWithPageScope(root);
    append(root, join('prototype', 'src', 'pages', 'MediaConfigPage.tsx'), '// 越权改动');
    const result = runLint(root);
    const violation = result.issues.find((item) => item.code === 'L001');
    expect(violation?.file).toBe('prototype/src/pages/MediaConfigPage.tsx');
  });

  it('Registry 自身的改动需要 Product Model 授权（L006）', () => {
    const root = workspace();
    featureWithPageScope(root);
    append(root, join('product', 'pages.yaml'), '');
    patch(root, join('product', 'pages.yaml'), 'name: 归因规则', 'name: 归因规则（改）');
    const result = runLint(root);
    const violation = result.issues.find((item) => item.code === 'L006');
    expect(violation?.file).toBe('product/pages.yaml');
  });

  it('authorizePath 在无 Registry 时保持 V0.1 语义', () => {
    const root = workspace();
    featureWithPageScope(root);
    const scope = loadScope(root, 'REQ-001');
    expect(scope).not.toBeNull();
    if (!scope) return;
    // 文件名与 page id 一致时旧规则仍然生效
    expect(authorizePath('prototype/src/pages/attribution_rule.tsx', scope).allowed).toBe(true);
    // 文件名与 page id 不一致且不传 Registry 时不授权（V0.1 的真实摩擦）
    expect(authorizePath('prototype/src/pages/AttributionRulesPage.tsx', scope).allowed).toBe(false);
    // 传入 Registry 后同一路径被授权
    expect(authorizePath('prototype/src/pages/AttributionRulesPage.tsx', scope, loadPageRegistry(root)).allowed).toBe(true);
    expect(authorizePath('prototype/src/pages/AttributionRulesPage.tsx', scope, loadPageRegistry(root)).reason).toBe('page_registry');
  });
});
