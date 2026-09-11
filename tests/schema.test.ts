import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { formatLint, runLint } from '../src/lint.js';
import { createFeature, initializeWorkspace } from '../src/workspace.js';

const roots: string[] = [];

function workspace(): string {
  const root = mkdtempSync(join(tmpdir(), 'proto-schema-'));
  roots.push(root);
  initializeWorkspace(root, true);
  return root;
}

afterEach(() => {
  for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true });
});

/** 替换文件内容；替换未生效时直接失败，避免测试因为“什么也没改”而假通过。 */
function patch(root: string, relative: string, from: string, to: string): void {
  const path = join(root, relative);
  const source = readFileSync(path, 'utf8');
  const updated = source.replace(from, to);
  expect(updated, `补丁未命中：${relative} 中的 ${JSON.stringify(from)}`).not.toBe(source);
  writeFileSync(path, updated, 'utf8');
}

describe('P0-1 schema validation', () => {
  it('合法的 V0.1 模板工作区仍然通过', () => {
    const root = workspace();
    const result = runLint(root);
    expect(result.pass).toBe(true);
    expect(result.checks).toContain('Schema: Product Model');
    expect(result.checks).toContain('Schema: Routes');
    expect(result.checks).toContain('Schema: Component Registry');
  });

  it('feature 分支上 scope 也通过 schema 校验', () => {
    const root = workspace();
    createFeature(root, 'REQ-001', '规则历史版本');
    const result = runLint(root);
    expect(result.pass).toBe(true);
    expect(result.checks).toContain('Schema: Feature Scope');
  });

  it('缺少必填字段：给出 L007、字段路径与修复建议', () => {
    const root = workspace();
    patch(root, join('product', 'product.yaml'), '  version: 0.1.0\n', '');
    const result = runLint(root);
    const issue = result.issues.find((item) => item.code === 'L007' && item.field === 'product.version');
    expect(issue, JSON.stringify(result.issues)).toBeDefined();
    expect(issue?.file).toBe('product/product.yaml');
    expect(issue?.fix && issue.fix.length).toBeGreaterThan(0);
    expect(formatLint(result)).toContain('Result: BLOCKED');
  });

  it('字段类型错误被 BLOCK（负例）', () => {
    const root = workspace();
    patch(root, join('product', 'product.yaml'), '  name: 归因平台', '  name: 123');
    const result = runLint(root);
    expect(result.issues.some((item) => item.code === 'L007' && item.field === 'product.name')).toBe(true);
  });

  it('未知字段被 BLOCK（负例）', () => {
    const root = workspace();
    patch(root, join('product', 'product.yaml'), '  version: 0.1.0', '  version: 0.1.0\n  unknown_key: 1');
    const result = runLint(root);
    expect(result.issues.some((item) => item.code === 'L007' && item.field === 'product.unknown_key')).toBe(true);
  });

  it('重复模块 id 被 BLOCK 为 L008', () => {
    const root = workspace();
    patch(root, join('product', 'product.yaml'), '  - id: attribution\n    name: 归因管理', '  - id: overview\n    name: 重复模块');
    const result = runLint(root);
    expect(result.issues.some((item) => item.code === 'L008' && item.field === 'modules[1].id')).toBe(true);
  });

  it('导航重复引用同一页面被 BLOCK 为 L008', () => {
    const root = workspace();
    patch(root, join('product', 'navigation.yaml'), '      - page: attribution_result\n        name: 归因结果', '      - page: attribution_rule\n        name: 重复入口');
    const result = runLint(root);
    expect(result.issues.some((item) => item.code === 'L008' && item.message.includes('attribution_rule'))).toBe(true);
  });

  it('路由指向不存在的模块被 BLOCK 为 L009', () => {
    const root = workspace();
    patch(root, join('product', 'routes.yaml'), '  dashboard:\n    path: /\n    module: overview', '  dashboard:\n    path: /\n    module: nonexistent');
    const result = runLint(root);
    const issue = result.issues.find((item) => item.code === 'L009');
    expect(issue?.field).toBe('routes.dashboard.module');
    expect(issue?.fix).toContain('product/product.yaml');
  });

  it('导航项同时声明 page 与 children 被 BLOCK（边界例）', () => {
    const root = workspace();
    patch(root, join('product', 'navigation.yaml'), '  - module: overview\n    name: 工作台', '  - module: overview\n    name: 工作台\n    page: dashboard');
    const result = runLint(root);
    expect(result.issues.some((item) => item.code === 'L007' && item.message.includes('page 与 children'))).toBe(true);
  });

  it('schema_version 缺失视为 1（边界例），不支持的值被 BLOCK', () => {
    const root = workspace();
    expect(runLint(root).pass).toBe(true);
    patch(root, join('product', 'product.yaml'), 'modules:', 'schema_version: 2\n\nmodules:');
    const result = runLint(root);
    expect(result.issues.some((item) => item.code === 'L007' && item.field === 'schema_version')).toBe(true);
  });

  it('合法的 schema_version: 1 不产生任何问题（正例）', () => {
    const root = workspace();
    patch(root, join('product', 'product.yaml'), 'modules:', 'schema_version: 1\n\nmodules:');
    expect(runLint(root).pass).toBe(true);
  });

  it('文本与 JSON 输出一致，code 稳定且 CI 可用', () => {
    const root = workspace();
    patch(root, join('product', 'product.yaml'), '  version: 0.1.0\n', '');
    const result = runLint(root);
    const json = JSON.parse(JSON.stringify(result)) as { pass: boolean; issues: Array<{ code: string; field?: string; fix?: string }> };
    expect(json.pass).toBe(false);
    expect(json.issues.every((item) => typeof item.code === 'string' && item.code.startsWith('L'))).toBe(true);
    expect(json.issues.some((item) => item.field === 'product.version' && Boolean(item.fix))).toBe(true);
    const text = formatLint(result);
    expect(text).toContain('Result: BLOCKED');
    expect(text).toContain('Field: product.version');
    expect(text).toContain('Fix:');
  });

  it('同一个错误不重复报告', () => {
    const root = workspace();
    patch(root, join('product', 'product.yaml'), '  version: 0.1.0\n', '');
    const result = runLint(root);
    const versionIssues = result.issues.filter((item) => item.field === 'product.version');
    expect(versionIssues).toHaveLength(1);
  });

  it('Feature Scope 缺少必填数组被 BLOCK', () => {
    const root = workspace();
    createFeature(root, 'REQ-001', '规则历史版本');
    patch(root, join('features', 'REQ-001', 'scope.yaml'), '  pages: []\n', '');
    const result = runLint(root);
    expect(result.issues.some((item) => item.code === 'L007' && item.field === 'allowed.pages')).toBe(true);
  });

  it('feature.id 与目录名不一致被 BLOCK（边界例）', () => {
    const root = workspace();
    createFeature(root, 'REQ-001', '规则历史版本');
    patch(root, join('features', 'REQ-001', 'scope.yaml'), '  id: REQ-001', '  id: REQ-999');
    const result = runLint(root);
    const issue = result.issues.find((item) => item.code === 'L007' && item.field === 'feature.id');
    expect(issue?.message).toContain('REQ-999');
    expect(issue?.fix).toContain('REQ-001');
  });

  it('产物文件缺失时给出可修复错误而不是抛异常', () => {
    const root = workspace();
    rmSync(join(root, 'components', 'registry.yaml'));
    const result = runLint(root);
    expect(result.pass).toBe(false);
    const issue = result.issues.find((item) => item.file === 'components/registry.yaml');
    expect(issue?.code).toBe('L007');
    expect(issue?.fix).toContain('proto init');
  });

  it('术语缺少 zh_CN 被 BLOCK（负例）', () => {
    const root = workspace();
    patch(root, join('product', 'terminology.yaml'), '  media:\n    zh_CN: 媒体', '  media:\n    en: media');
    const result = runLint(root);
    expect(result.issues.some((item) => item.code === 'L007' && item.field === 'terms.media.zh_CN')).toBe(true);
  });
});
