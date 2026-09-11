import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { runLint } from '../src/lint.js';
import { createFeature, initializeWorkspace } from '../src/workspace.js';
import { patch, readText as read, writeText as write } from './helpers.js';

const roots: string[] = [];

function workspace(): string {
  const root = mkdtempSync(join(tmpdir(), 'proto-rules-'));
  roots.push(root);
  initializeWorkspace(root, true);
  return root;
}

afterEach(() => {
  for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true });
});

function scopeYaml(feature: string, body: string): string {
  return `feature:\n  id: ${feature}\n  name: ${feature}\n\nallowed:\n${body}\nforbidden: []\n`;
}

/** 直接在 features/ 下造一个 Feature 目录（用于跨 Feature 语义检查，不需要 git 分支）。 */
function fakeFeature(root: string, id: string, scenarios: string, scopeBody = '  pages: []\n  shared_components: []\n  product_model: []\n  paths: []\n'): void {
  write(root, join('features', id, 'scope.yaml'), scopeYaml(id, scopeBody));
  // 真实工作区的写法是 scenarios: 下挂列表，夹具必须与真实数据同形
  write(root, join('features', id, 'scenarios.yaml'), `scenarios:\n${scenarios}`);
}

/** 写入任意原始内容的 scenarios.yaml（用于形状兼容与畸形用例）。 */
function rawScenarios(root: string, id: string, content: string): void {
  write(root, join('features', id, 'scope.yaml'), scopeYaml(id, '  pages: []\n  shared_components: []\n  product_model: []\n  paths: []\n'));
  write(root, join('features', id, 'scenarios.yaml'), content);
}

const SCENARIO = (id: string, given: string, when: string, then: string): string =>
  `  - id: ${id}\n    given: ${given}\n    when: ${when}\n    then: ${then}\n`;

describe('P0-4 lint 规则矩阵', () => {
  describe('L012 Scope 引用不存在的对象', () => {
    it('正例：Scope 只引用已定义对象时无 L012', () => {
      const root = workspace();
      createFeature(root, 'REQ-001', '归因规则');
      write(root, join('features', 'REQ-001', 'scope.yaml'), scopeYaml('REQ-001', '  pages:\n    - attribution_rule\n  shared_components:\n    - SearchForm\n  product_model:\n    - routes\n  paths:\n    - features/REQ-001/**\n'));
      const result = runLint(root);
      expect(result.issues.filter((item) => item.code === 'L012'), JSON.stringify(result.issues)).toHaveLength(0);
      expect(result.checks).toContain('Scope references');
    });

    it('负例：allowed.pages 指向不存在的页面 → L012（含字段与修复建议）', () => {
      const root = workspace();
      createFeature(root, 'REQ-001', '归因规则');
      write(root, join('features', 'REQ-001', 'scope.yaml'), scopeYaml('REQ-001', '  pages:\n    - ghost_page\n  shared_components: []\n  product_model: []\n  paths: []\n'));
      const issue = runLint(root).issues.find((item) => item.code === 'L012');
      expect(issue).toBeDefined();
      expect(issue?.field).toBe('allowed.pages[0]');
      expect(issue?.message).toContain('ghost_page');
      expect(issue?.fix && issue.fix.length).toBeGreaterThan(0);
    });

    it('负例：allowed.shared_components 指向未登记组件 → L012', () => {
      const root = workspace();
      createFeature(root, 'REQ-001', '归因规则');
      write(root, join('features', 'REQ-001', 'scope.yaml'), scopeYaml('REQ-001', '  pages: []\n  shared_components:\n    - GhostWidget\n  product_model: []\n  paths: []\n'));
      const issue = runLint(root).issues.find((item) => item.code === 'L012');
      expect(issue?.field).toBe('allowed.shared_components[0]');
      expect(issue?.message).toContain('GhostWidget');
    });

    it('负例：allowed.product_model 指向不存在的 Product Model → L012', () => {
      const root = workspace();
      createFeature(root, 'REQ-001', '归因规则');
      write(root, join('features', 'REQ-001', 'scope.yaml'), scopeYaml('REQ-001', '  pages: []\n  shared_components: []\n  product_model:\n    - ghost_model\n  paths: []\n'));
      const issue = runLint(root).issues.find((item) => item.code === 'L012');
      expect(issue?.field).toBe('allowed.product_model[0]');
    });

    it('边界例：product_model: [pages] 在 pages.yaml 存在时合法，删除后转为 L012', () => {
      const root = workspace();
      createFeature(root, 'REQ-001', '归因规则');
      write(root, join('features', 'REQ-001', 'scope.yaml'), scopeYaml('REQ-001', '  pages: []\n  shared_components: []\n  product_model:\n    - pages\n  paths: []\n'));
      expect(runLint(root).issues.filter((item) => item.code === 'L012')).toHaveLength(0);
      rmSync(join(root, 'product', 'pages.yaml'));
      const issue = runLint(root).issues.find((item) => item.code === 'L012');
      expect(issue?.field).toBe('allowed.product_model[0]');
    });
  });

  describe('L013 跨 Feature 产品语义重复 / 冲突', () => {
    it('正例：同一 Feature 内部重复场景不算跨 Feature 冲突', () => {
      const root = workspace();
      fakeFeature(root, 'REQ-A', SCENARIO('s1', '已登录用户', '点击导出', '下载文件') + SCENARIO('s2', '已登录用户', '点击导出', '下载文件'));
      expect(runLint(root).issues.filter((item) => item.code === 'L013')).toHaveLength(0);
    });

    it('负例：两个 Feature 声明完全相同的场景 → L013（消息含双方 Feature 与场景 id）', () => {
      const root = workspace();
      fakeFeature(root, 'REQ-A', SCENARIO('s1', '选择两个规则版本', '点击对比', '展示差异明细'));
      fakeFeature(root, 'REQ-B', SCENARIO('s9', '选择两个规则版本', '点击对比', '展示差异明细'));
      const issue = runLint(root).issues.find((item) => item.code === 'L013');
      expect(issue).toBeDefined();
      expect(issue?.message).toContain('REQ-A');
      expect(issue?.message).toContain('REQ-B');
      expect(issue?.message).toContain('s1');
      expect(issue?.message).toContain('s9');
      expect(issue?.file).toBe('features/REQ-B/scenarios.yaml');
    });

    it('负例：同一触发条件给出不同结果 → L013 语义冲突', () => {
      const root = workspace();
      fakeFeature(root, 'REQ-A', SCENARIO('s1', '选择两个规则版本', '点击对比', '展示差异明细'));
      fakeFeature(root, 'REQ-B', SCENARIO('s9', '选择两个规则版本', '点击对比', '覆盖当前版本'));
      const issue = runLint(root).issues.find((item) => item.code === 'L013');
      expect(issue?.message).toContain('不同结果');
    });

    it('边界例：大小写、行首尾空白与连续空白差异视为同一语义', () => {
      const root = workspace();
      fakeFeature(root, 'REQ-A', SCENARIO('s1', 'Select Versions', 'Click Compare', '展示差异明细'));
      fakeFeature(root, 'REQ-B', SCENARIO('s9', '  select  versions  ', 'click compare', '展示差异明细'));
      expect(runLint(root).issues.filter((item) => item.code === 'L013').length).toBeGreaterThan(0);
    });

    it('边界例：连续空白被折叠后仍不同的表述不算重复（避免误报）', () => {
      const root = workspace();
      fakeFeature(root, 'REQ-A', SCENARIO('s1', '选择两个规则版本', '点击对比', '展示差异明细'));
      fakeFeature(root, 'REQ-B', SCENARIO('s9', '选择两个   规则版本', '点击对比', '展示差异明细'));
      expect(runLint(root).issues.filter((item) => item.code === 'L013')).toHaveLength(0);
    });

    it('兼容：裸数组写法同样被检查（不因形状不同而静默跳过）', () => {
      const root = workspace();
      rawScenarios(root, 'REQ-A', '- id: s1\n  given: 选择两个规则版本\n  when: 点击对比\n  then: 展示差异明细\n');
      rawScenarios(root, 'REQ-B', '- id: s9\n  given: 选择两个规则版本\n  when: 点击对比\n  then: 展示差异明细\n');
      expect(runLint(root).issues.filter((item) => item.code === 'L013').length).toBeGreaterThan(0);
    });

    it('负例：scenarios.yaml 结构无法识别时给出 L007 而不是静默通过', () => {
      const root = workspace();
      rawScenarios(root, 'REQ-A', 'list:\n  - id: s1\n    given: 选择两个规则版本\n    when: 点击对比\n');
      const issue = runLint(root).issues.find((item) => item.code === 'L007' && item.file === 'features/REQ-A/scenarios.yaml');
      expect(issue).toBeDefined();
      expect(issue?.field).toBe('scenarios');
    });
  });

  describe('L010 已删除文件仍被 Registry 引用', () => {
    it('负例：Registry 引用的实现文件被删除 → L010 且提示同步更新登记', () => {
      const root = workspace();
      rmSync(join(root, 'prototype', 'src', 'pages', 'DashboardPage.tsx'));
      const issue = runLint(root).issues.find((item) => item.code === 'L010' && item.field === 'pages.dashboard.file');
      expect(issue).toBeDefined();
      expect(issue?.message).toContain('不存在');
      expect(issue?.fix).toContain('删除');
    });
  });

  describe('完整报告与既有规则', () => {
    it('多类错误一次性完整报告（不允许只报第一条）', () => {
      const root = workspace();
      createFeature(root, 'REQ-001', '归因规则');
      write(root, join('features', 'REQ-001', 'scope.yaml'), scopeYaml('REQ-001', '  pages:\n    - ghost_page\n  shared_components: []\n  product_model:\n    - ghost_model\n  paths: []\n'));
      patch(root, join('product', 'pages.yaml'), 'name: 产品总览', 'name: 产品总览\n    unknown_field: 1');
      patch(root, join('product', 'pages.yaml'), 'file: prototype/src/pages/MediaConfigPage.tsx', 'file: prototype/src/pages/DeletedPage.tsx');
      const result = runLint(root);
      const codes = new Set(result.issues.map((item) => item.code));
      expect(result.pass).toBe(false);
      // 结构错误（未知字段 L007）+ Registry 与实现不一致（L010）+ Scope 引用不存在（L012）
      expect([...codes]).toEqual(expect.arrayContaining(['L007', 'L010', 'L012']));
      expect(result.issues.filter((item) => item.code === 'L012')).toHaveLength(2);
      expect(result.issues.filter((item) => item.code === 'L010').length).toBeGreaterThanOrEqual(1);
      for (const issue of result.issues) {
        expect(issue.file && issue.file.length, `缺少 file 的 issue：${issue.code}`).toBeGreaterThan(0);
        expect(issue.message.length).toBeGreaterThan(0);
      }
    });

    it('回归：越权修改仍然 BLOCK（L001）', () => {
      const root = workspace();
      createFeature(root, 'REQ-001', '归因规则');
      write(root, join('features', 'REQ-001', 'scope.yaml'), scopeYaml('REQ-001', '  pages: []\n  shared_components: []\n  product_model: []\n  paths:\n    - features/REQ-001/**\n'));
      writeFileSync(join(root, 'prototype', 'src', 'pages', 'MediaConfigPage.tsx'), `${read(root, join('prototype', 'src', 'pages', 'MediaConfigPage.tsx'))}\n// 越权\n`, 'utf8');
      expect(runLint(root).issues.some((item) => item.code === 'L001' && item.file === 'prototype/src/pages/MediaConfigPage.tsx')).toBe(true);
    });

    it('回归：模板工作区（干净 main）无任何 issue 且检查项覆盖全部规则族', () => {
      const root = workspace();
      const result = runLint(root);
      expect(result.pass, JSON.stringify(result.issues)).toBe(true);
      for (const check of ['Schema: Product Model', 'Schema: Page Registry', 'Capability keys', 'Cross-Feature semantics', 'Terminology references', 'Component registry']) {
        expect(result.checks, `缺少检查项 ${check}`).toContain(check);
      }
    });
  });
});
