import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { createDiff, formatDiff } from '../src/diff.js';
import { currentFeature, git } from '../src/git.js';
import { createFeature, initializeWorkspace } from '../src/workspace.js';

const roots: string[] = [];

function workspace(): string {
  const root = mkdtempSync(join(tmpdir(), 'proto-diff-'));
  roots.push(root);
  initializeWorkspace(root, true);
  return root;
}

afterEach(() => {
  for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true });
});

function commit(root: string, message: string): void {
  git(root, ['add', '--', '.']);
  git(root, ['-c', 'user.name=Diff Test', '-c', 'user.email=diff@local', 'commit', '-m', message]);
}

function merge(root: string, branch: string): void {
  git(root, ['-c', 'user.name=Diff Test', '-c', 'user.email=diff@local', 'merge', '--no-ff', branch, '-m', `merge: ${branch}`]);
}

function yamlList(values: string[]): string {
  return values.length === 0 ? ' []' : `\n${values.map((value) => `    - ${value}`).join('\n')}`;
}

interface ScopeInput {
  pages?: string[];
  paths?: string[];
  productModel?: string[];
  sharedComponents?: string[];
}

function writeScope(root: string, id: string, name: string, input: ScopeInput = {}): void {
  const source = `feature:\n  id: ${id}\n  name: ${name}\n\nallowed:\n  pages:${yamlList(input.pages ?? [])}\n  shared_components:${yamlList(input.sharedComponents ?? [])}\n  product_model:${yamlList(input.productModel ?? [])}\n  paths:${yamlList(input.paths ?? [])}\n\nforbidden:\n  - product/permissions.yaml\n  - product/terminology.yaml\n`;
  writeFileSync(join(root, 'features', id, 'scope.yaml'), source, 'utf8');
}

function append(root: string, path: string, text: string): void {
  writeFileSync(join(root, path), `${readFileSync(join(root, path), 'utf8')}${text}`, 'utf8');
}

const V1_REQUIREMENT = `# 归因规则历史版本对比

## 背景

历史版本只能逐条查看，版本之间的字段变化需要人工比对。

## 目标

允许勾选两个历史版本并点击“对比”，直接查看两个版本的字段差异。

## 用户行为

用户在版本条目左侧勾选两个版本，底部“对比”按钮由禁用变为可用。

## 页面变化

- Drawer 内的版本条目增加勾选框。
- Drawer footer 增加“对比”按钮。

## 核心规则

- 只允许勾选两个版本；勾选第三个版本时自动取消最早勾选的版本。
- “对比”按钮仅在恰好选中两个版本时可用。
`;

const V2_REQUIREMENT = `# 归因规则历史版本与当前版本对比

## 背景

评审人需要确认某次历史调整相对当前生效版本改了什么，手工比对容易出错。

## 目标

用户点击某个历史版本的“与当前版本对比”，系统直接将该历史版本与当前生效版本比较并展示字段差异。

## 用户行为

当前生效版本条目上的“与当前版本对比”按钮禁用，其余历史版本条目上该按钮可点击。

## 页面变化

- 每个版本条目增加“与当前版本对比”按钮。
- 不再提供版本勾选，也不再有全局“对比”按钮：对比目标由用户点击的条目决定。

## 核心规则

- 当前生效版本取版本列表中状态为“已启用”的版本；历史版本为其余条目。
- 一次对比只涉及两个版本：被点击的历史版本与当前生效版本。
- 当前生效版本自身不可作为对比对象，其按钮禁用。
`;

const V1_SCENARIOS = `scenarios:
  - id: open-version-drawer
    given: 归因规则列表存在至少一条规则且该规则有历史版本
    when: 用户点击“查看历史版本”
    then: 版本历史 Drawer 打开，每个版本条目都带有可勾选的对比选择框
  - id: compare-requires-two-versions
    given: 版本历史 Drawer 已打开
    when: 用户未勾选或只勾选一个版本
    then: “对比”按钮处于禁用状态且不展示对比结果
  - id: compare-two-versions
    given: 版本历史 Drawer 已打开
    when: 用户勾选两个版本并点击“对比”
    then: 展示这两个版本的字段差异行，并给出差异字段数量
  - id: keep-selection-at-two
    given: 用户已勾选两个版本
    when: 用户再勾选第三个版本
    then: 最早勾选的版本被自动取消勾选，选中数量保持为 2
`;

const V2_SCENARIOS = `scenarios:
  - id: open-version-drawer
    given: 归因规则列表存在至少一条规则且该规则有历史版本
    when: 用户点击“查看历史版本”
    then: 版本历史 Drawer 打开，每个版本条目展示状态与该历史版本的字段详情
  - id: no-version-selection-controls
    given: 版本历史 Drawer 已打开
    when: 用户查看 Drawer 内的可用操作
    then: 不存在版本勾选框，也不存在与条目无关的全局“对比”按钮
  - id: current-version-cannot-be-compared
    given: 版本列表中存在状态为已启用的当前生效版本
    when: 用户查看当前生效版本条目
    then: 该条目的“与当前版本对比”按钮为禁用状态
  - id: compare-history-with-current
    given: 版本历史 Drawer 已打开且当前生效版本为 v3
    when: 用户点击历史版本 v1 的“与当前版本对比”
    then: 展示 v3 与 v1 的字段差异行，并给出差异字段数量
`;

describe('product diff classification', () => {
  it('classifies every changed file exactly once and keeps page files out of prototype files', () => {
    const root = workspace();
    createFeature(root, 'REQ-DIFF-001', '分类互斥');
    writeScope(root, 'REQ-DIFF-001', '分类互斥', {
      pages: ['attribution_rule'],
      paths: ['features/REQ-DIFF-001/**', 'prototype/src/pages/AttributionRulesPage.tsx', 'prototype/src/features/rule-history/**'],
    });
    writeFileSync(join(root, 'prototype', 'src', 'pages', 'AttributionRulesPage.tsx'), '// 页面变更\n', 'utf8');
    mkdirSync(join(root, 'prototype', 'src', 'features', 'rule-history'), { recursive: true });
    writeFileSync(join(root, 'prototype', 'src', 'features', 'rule-history', 'index.tsx'), '// 新增特性文件\n', 'utf8');

    const diff = createDiff(root);
    const pagePath = 'prototype/src/pages/AttributionRulesPage.tsx';
    expect(diff.pages.map((file) => file.path)).toContain(pagePath);
    expect(diff.prototypeFiles.map((file) => file.path)).not.toContain(pagePath);
    expect(diff.prototypeFiles.map((file) => file.path)).toContain('prototype/src/features/rule-history/index.tsx');
    expect(diff.classification.overlaps).toEqual([pagePath]);
    expect(diff.classification.assigned[pagePath]).toBe('pages');

    const grouped = diff.productModel.length + diff.pages.length + diff.sharedComponents.length + diff.featureFiles.length + diff.prototypeFiles.length + diff.otherFiles.length;
    expect(grouped).toBe(diff.changedFiles.length);
    expect(new Set(diff.changedFiles.map((file) => file.path)).size).toBe(diff.changedFiles.length);
    expect(diff.classification.total).toBe(diff.changedFiles.length);
    expect(diff.classification.categorized).toBe(diff.changedFiles.length);
    expect(diff.classification.uncategorized).toEqual([]);

    const text = formatDiff(diff);
    expect(text).toContain('Multi-Category Files (counted once): 1');
    expect(text).toContain(`${pagePath} → pages`);
    // 低信息量行不再占用输出（分类总数由 5 个分组计数自证，JSON 保留 classification 供 CI 使用）
    expect(text).not.toContain('Categorized:');
    expect(text).not.toContain('Uncategorized');
  });
});

describe('requirement replacement (V1 → V2)', () => {
  it('reports removed capabilities, removed artifacts and explicit replacement wording', () => {
    const root = workspace();
    createFeature(root, 'REQ-V02-001', '归因规则历史版本对比');
    writeScope(root, 'REQ-V02-001', '归因规则历史版本对比', {
      pages: ['attribution_rule'],
      paths: ['features/REQ-V02-001/**', 'prototype/src/features/attribution-rule-version/**'],
    });
    const dir = join(root, 'prototype', 'src', 'features', 'attribution-rule-version');
    mkdirSync(dir, { recursive: true });
    const specBase = readFileSync(join(root, 'specs', 'attribution_rule.md'), 'utf8');

    // V1：勾选两个历史版本对比
    writeFileSync(join(root, 'features', 'REQ-V02-001', 'requirement.md'), V1_REQUIREMENT, 'utf8');
    writeFileSync(join(root, 'features', 'REQ-V02-001', 'scenarios.yaml'), V1_SCENARIOS, 'utf8');
    writeFileSync(join(dir, 'versions.ts'), 'export const versions = [];\n', 'utf8');
    writeFileSync(join(dir, 'RuleVersionCompare.tsx'), 'export const RuleVersionCompare = () => null;\n', 'utf8');
    writeFileSync(join(dir, 'RuleVersionDrawer.tsx'), 'export const RuleVersionDrawer = () => null;\n', 'utf8');
    writeFileSync(join(root, 'specs', 'attribution_rule.md'), `${specBase}\n- 对比入口：勾选两个历史版本后点击「对比」。\n`, 'utf8');
    commit(root, 'feat: compare two selected versions');

    // V2：反悔，改成每个历史版本与当前版本对比
    writeScope(root, 'REQ-V02-001', '归因规则历史版本与当前版本对比', {
      pages: ['attribution_rule'],
      paths: ['features/REQ-V02-001/**', 'prototype/src/features/attribution-rule-version/**'],
    });
    writeFileSync(join(root, 'features', 'REQ-V02-001', 'requirement.md'), V2_REQUIREMENT, 'utf8');
    writeFileSync(join(root, 'features', 'REQ-V02-001', 'scenarios.yaml'), V2_SCENARIOS, 'utf8');
    rmSync(join(dir, 'versions.ts'));
    writeFileSync(join(dir, 'RuleVersionCompare.tsx'), 'export const RuleVersionCompare = () => "current";\n', 'utf8');
    writeFileSync(join(dir, 'RuleVersionDrawer.tsx'), 'export const RuleVersionDrawer = () => "current";\n', 'utf8');
    writeFileSync(join(root, 'specs', 'attribution_rule.md'), `${specBase}\n- 对比入口：点击历史版本的「与当前版本对比」。\n`, 'utf8');
    commit(root, 'feat: compare each version against the current version');

    const diff = createDiff(root);
    const feature = diff.features.find((item) => item.id === 'REQ-V02-001');
    expect(feature).toBeDefined();
    if (!feature) return;

    // 净差（base..HEAD）已经看不出被删除的 versions.ts
    expect(diff.changedFiles.map((file) => file.path)).not.toContain('prototype/src/features/attribution-rule-version/versions.ts');
    expect(diff.removedArtifacts.map((item) => item.path)).toContain('prototype/src/features/attribution-rule-version/versions.ts');

    expect(feature.revision.fromKind).toBe('introducing-commit');
    expect(feature.revision.revisionCount).toBe(2);
    expect(feature.revision.from).toHaveLength(40);
    expect(feature.revision.nameBefore).toBe('归因规则历史版本对比');
    expect(feature.revision.nameAfter).toBe('归因规则历史版本与当前版本对比');

    // 相对 base 的能力视角只能看到“全部新增”，无法表达反悔
    expect(feature.capabilitiesVsBase.removed).toEqual([]);
    expect(feature.capabilitiesVsBase.added).toHaveLength(4);

    // V1 → 最新版本的能力视角能表达反悔
    expect(feature.revision.capabilities.removed.map((item) => item.id)).toEqual(['compare-requires-two-versions', 'compare-two-versions', 'keep-selection-at-two']);
    expect(feature.revision.capabilities.added.map((item) => item.id).sort()).toEqual(['compare-history-with-current', 'current-version-cannot-be-compared', 'no-version-selection-controls']);
    expect(feature.revision.capabilities.modified.map((item) => item.id)).toEqual(['open-version-drawer']);

    // 明确写出“旧交互被移除/替换”，且完全确定性
    const messages = diff.requirementReplacements.map((item) => item.message).join('\n');
    expect(messages).toContain('旧交互被移除');
    expect(messages).toContain('旧交互被替换');
    expect(diff.requirementReplacements.some((item) => item.kind === 'removed' && item.subject === 'compare-two-versions')).toBe(true);
    expect(diff.requirementReplacements.some((item) => item.kind === 'replaced' && item.source.endsWith('requirement.md') && item.subject === '§目标')).toBe(true);
    expect(diff.risks.some((item) => item.code === 'R001')).toBe(true);
    expect(diff.risks.some((item) => item.code === 'R002')).toBe(true);

    const text = formatDiff(diff);
    expect(text).toContain('REQUIREMENT REPLACEMENTS (V1 → latest)');
    expect(text).toContain('旧交互被移除');
    expect(text).toContain('versions.ts');
    expect(text).toContain('REMOVED ARTIFACTS (V1 → latest): 1');
    // B1：两种比较口径必须写明含义
    expect(text).toContain('比较口径：base = 主分支 merge-base 状态；V1 = 本分支中该 Feature 的第一个修订提交；latest = 当前工作区。');
    expect(text).toContain('计数含义：+ 新增 / ~ 修改 / - 删除 的能力条数。');
    // B2：文本里每条替换只标注一次“旧交互被移除/替换”，不再逐条重复同一句式
    expect((text.match(/—— 旧交互被移除\/替换/g) ?? []).length).toBeGreaterThan(0);
    expect(text).not.toContain('小节的 V1 描述已被最新版本替换。');

    // 确定性：同样输入重复运行必须逐字节一致
    expect(JSON.stringify(createDiff(root))).toBe(JSON.stringify(diff));
  });

  it('reports no replacement when the feature was introduced once and never revised', () => {
    const root = workspace();
    createFeature(root, 'REQ-V02-002', '复制归因规则');
    writeScope(root, 'REQ-V02-002', '复制归因规则', {
      pages: ['attribution_rule'],
      paths: ['features/REQ-V02-002/**', 'prototype/src/pages/AttributionRulesPage.tsx'],
    });
    writeFileSync(join(root, 'features', 'REQ-V02-002', 'requirement.md'), V2_REQUIREMENT, 'utf8');
    writeFileSync(join(root, 'features', 'REQ-V02-002', 'scenarios.yaml'), V2_SCENARIOS, 'utf8');
    append(root, 'prototype/src/pages/AttributionRulesPage.tsx', '// 复制规则入口\n');
    commit(root, 'feat: copy attribution rule');

    const diff = createDiff(root);
    const feature = diff.features.find((item) => item.id === 'REQ-V02-002');
    expect(feature).toBeDefined();
    if (!feature) return;    expect(feature.revision.fromKind).toBe('introducing-commit');
    expect(feature.revision.revisionCount).toBe(1);
    // 只有一个修订版本时，V1 → 最新版本之间没有变化，因此不会出现任何替换信号
    expect(feature.revision.capabilities.added).toEqual([]);
    expect(feature.revision.capabilities.removed).toEqual([]);
    expect(feature.revision.capabilities.modified).toEqual([]);
    // 相对 base 仍然能看到该 Feature 新增的用户能力
    expect(feature.capabilitiesVsBase.added).toHaveLength(4);
    expect(feature.revision.replacements).toEqual([]);
    expect(feature.revision.removedArtifacts).toEqual([]);
    expect(diff.requirementReplacements).toEqual([]);
    expect(diff.removedArtifacts).toEqual([]);
    expect(diff.risks.some((item) => item.code === 'R001')).toBe(false);
    expect(diff.risks.some((item) => item.code === 'R002')).toBe(false);
    expect(formatDiff(diff)).toContain('None（未检测到旧交互被移除/替换）');
  });
});

describe('empty and merged diffs', () => {
  it('reports an empty diff on the base branch', () => {
    const root = workspace();
    const diff = createDiff(root);
    expect(diff.changedFiles).toEqual([]);
    expect(diff.classification).toMatchObject({ total: 0, categorized: 0, uncategorized: [], overlaps: [] });
    expect(diff.features).toEqual([]);
    expect(diff.changedPages).toEqual([]);
    expect(diff.requirementReplacements).toEqual([]);
    expect(diff.removedArtifacts).toEqual([]);
    expect(diff.navigation).toMatchObject({ changed: false, added: [], removed: [], modified: [] });
    expect(diff.routes).toMatchObject({ changed: false, added: [], removed: [], modified: [] });
    expect(diff.sharedComponentDiff).toMatchObject({ changed: false, added: [], removed: [], modified: [] });
    expect(diff.sharedComponentDiff.capabilityKeys).toMatchObject({ changed: false, added: [], removed: [], modified: [], duplicates: [] });
    expect(diff.scope.status).toBe('PASS');
    expect(diff.risks.map((item) => item.code)).toContain('R010');
    const text = formatDiff(diff);
    expect(text).toContain('Changed Files: 0');
    // B3：空的“未定义规则”段落不再输出
    expect(text).not.toContain('UNDEFINED RULES');
    expect(text).toContain('RISKS: 1');
  });

  it('derives every feature introduced by a merged non-feature branch', () => {
    const root = workspace();
    createFeature(root, 'REQ-MERGE-A', '历史版本对比');
    writeScope(root, 'REQ-MERGE-A', '历史版本对比', { pages: ['attribution_rule'], paths: ['features/REQ-MERGE-A/**'] });
    append(root, 'specs/attribution_rule.md', '- A：历史版本对比入口。\n');
    commit(root, 'feat: A');

    git(root, ['switch', 'main']);
    createFeature(root, 'REQ-MERGE-B', '复制归因规则');
    writeScope(root, 'REQ-MERGE-B', '复制归因规则', { pages: ['attribution_rule'], paths: ['features/REQ-MERGE-B/**'] });
    append(root, 'prototype/src/pages/AttributionRulesPage.tsx', '// B：复制规则入口\n');
    commit(root, 'feat: B');

    git(root, ['switch', 'main']);
    git(root, ['switch', '-c', 'integration/v02']);
    merge(root, 'feature/REQ-MERGE-A');
    merge(root, 'feature/REQ-MERGE-B');

    expect(currentFeature(root)).toBeNull();
    const diff = createDiff(root);
    expect(diff.features.map((item) => item.id)).toEqual(['REQ-MERGE-A', 'REQ-MERGE-B']);
    expect(diff.features.map((item) => item.name)).toEqual(['历史版本对比', '复制归因规则']);
    expect(diff.features.every((item) => item.origin === 'files')).toBe(true);
    expect(diff.features.every((item) => item.status === 'added')).toBe(true);
    expect(diff.risks.some((item) => item.code === 'R008')).toBe(true);
    expect(diff.undefinedRules.some((item) => item.code === 'U008')).toBe(true);

    const page = diff.changedPages.find((item) => item.pageId === 'attribution_rule');
    expect(page).toBeDefined();
    expect(page?.product).toBe('归因平台');
    expect(page?.mapping).toBe('registry');
    expect(page?.features).toEqual(['REQ-MERGE-A', 'REQ-MERGE-B']);
    expect(diff.risks.some((item) => item.code === 'R003')).toBe(true);
    expect(formatDiff(diff)).toContain('FEATURES (vs base): 2');
  });

  it('prefers the P0-3 Page Registry for the file → page id mapping', () => {
    const root = workspace();
    createFeature(root, 'REQ-DIFF-006', 'Registry 优先');
    // Scope 只写 allowed.pages（不手工补实现文件路径）：与 P0-3 后 proto lint 的口径一致
    writeScope(root, 'REQ-DIFF-006', 'Registry 优先', { pages: ['attribution_rule'], paths: ['features/REQ-DIFF-006/**'] });
    append(root, 'prototype/src/pages/AttributionRulesPage.tsx', '// Registry 映射\n');
    append(root, 'specs/attribution_rule.md', '- Registry 映射。\n');
    commit(root, 'feat: registry mapping');

    const diff = createDiff(root);
    const page = diff.changedPages.find((item) => item.pageId === 'attribution_rule');
    expect(page?.mapping).toBe('registry');
    expect(page?.name).toBe('归因规则');
    expect(page?.route).toBe('/attribution/rules (attribution)');
    expect(page?.files).toEqual(['prototype/src/pages/AttributionRulesPage.tsx', 'specs/attribution_rule.md']);
    // B4：diff 的 Scope 必须与 proto lint 同口径 —— Registry 让 allowed.pages 直接授权真实实现文件
    expect(diff.scope.status).toBe('PASS');
    expect(diff.scope.scopeViolations).toEqual([]);
  });

  it('does not invent a phantom page for a spec that the Registry does not register', () => {
    const root = workspace();
    createFeature(root, 'REQ-DIFF-008', '未登记 spec');
    writeScope(root, 'REQ-DIFF-008', '未登记 spec', { paths: ['features/REQ-DIFF-008/**', 'specs/**'] });
    mkdirSync(join(root, 'specs'), { recursive: true });
    writeFileSync(join(root, 'specs', 'device_type_distribution.md'), '# device_type_distribution\n', 'utf8');

    const diff = createDiff(root);
    const page = diff.changedPages.find((item) => item.files.includes('specs/device_type_distribution.md'));
    expect(page?.pageId).toBeNull();
    expect(page?.mapping).toBe('unmapped');
    expect(diff.undefinedRules.some((item) => item.code === 'U002' && item.file === 'specs/device_type_distribution.md')).toBe(true);
    // 未解析出 page 时，不得把文件名当作 page id 写进 FEATURES
    const feature = diff.features.find((item) => item.id === 'REQ-DIFF-008');
    expect(feature?.changedPages).toEqual([]);
  });

  it('falls back to a labeled normalization mapping when neither Registry nor App map exists', () => {
    const root = workspace();
    createFeature(root, 'REQ-DIFF-003', '无显式映射');
    writeScope(root, 'REQ-DIFF-003', '无显式映射', { pages: ['attribution_rule'], paths: ['features/REQ-DIFF-003/**', 'prototype/**'], productModel: ['pages'] });
    rmSync(join(root, 'product', 'pages.yaml'));
    writeFileSync(join(root, 'prototype', 'src', 'App.tsx'), 'export default function App() { return null; }\n', 'utf8');
    append(root, 'prototype/src/pages/AttributionRulesPage.tsx', '// 无显式映射\n');
    commit(root, 'chore: drop explicit page map');

    const page = createDiff(root).changedPages.find((item) => item.pageId === 'attribution_rule');
    expect(page?.mapping).toBe('normalized');
    expect(page?.name).toBe('归因规则');
  });
});

describe('product model and scope signals', () => {
  it('keeps the JSON contract field set stable', () => {
    const root = workspace();
    createFeature(root, 'REQ-DIFF-005', '合同稳定性');
    writeScope(root, 'REQ-DIFF-005', '合同稳定性', { pages: ['attribution_rule'], paths: ['features/REQ-DIFF-005/**'] });
    append(root, 'specs/attribution_rule.md', '- 合同检查。\n');
    commit(root, 'feat: contract');

    const diff = createDiff(root);
    expect(diff.contractVersion).toBe('1');
    expect(Object.keys(diff).sort()).toEqual([
      'changedFiles', 'changedPages', 'classification', 'contractVersion', 'featureFiles', 'features', 'navigation', 'otherFiles',
      'pages', 'product', 'productModel', 'prototypeFiles', 'removedArtifacts', 'requirementReplacements', 'risks', 'routes',
      'scope', 'sharedComponentDiff', 'sharedComponents', 'undefinedRules',
    ].sort());
    expect(Object.keys(diff.classification).sort()).toEqual(['assigned', 'categorized', 'overlaps', 'total', 'uncategorized']);
    expect(Object.keys(diff.scope).sort()).toEqual(['checkedFiles', 'error', 'feature', 'scopeViolations', 'status']);
    expect(Object.keys(diff.sharedComponentDiff).sort()).toEqual(['added', 'capabilityKeys', 'changed', 'modified', 'removed']);
    expect(Object.keys(diff.sharedComponentDiff.capabilityKeys).sort()).toEqual(['added', 'changed', 'duplicates', 'modified', 'removed']);
    expect(Object.keys(diff.features[0] ?? {}).sort()).toEqual(['capabilitiesVsBase', 'capabilityCount', 'changedPages', 'files', 'id', 'name', 'origin', 'revision', 'status']);
    expect(Object.keys(diff.features[0]?.revision ?? {}).sort()).toEqual(['capabilities', 'from', 'fromKind', 'nameAfter', 'nameBefore', 'removedArtifacts', 'replacements', 'revisionCount', 'to']);
    for (const file of diff.pages) expect(Object.keys(file).sort()).toEqual(['path', 'status']);
    expect(JSON.parse(JSON.stringify(diff)).changedFiles.length).toBe(diff.changedFiles.length);
  });

  it('detects navigation, route and capability_key changes', () => {
    const root = workspace();
    createFeature(root, 'REQ-DIFF-004', '产品结构变化');
    writeScope(root, 'REQ-DIFF-004', '产品结构变化', {
      paths: ['features/REQ-DIFF-004/**', 'components/registry.yaml'],
      productModel: ['navigation', 'routes'],
    });
    append(root, 'product/navigation.yaml', '  - module: attribution\n    name: 归因管理\n    children:\n      - page: device_whitelist\n        name: 设备白名单\n');
    append(root, 'product/routes.yaml', '  device_whitelist:\n    path: /attribution/whitelist\n    module: attribution\n');
    writeFileSync(join(root, 'components', 'registry.yaml'), `components:\n  DataTable:\n    description: 标准数据表格容器\n    type: shared\n    capability_key: data-table\n  SearchForm:\n    description: 响应式查询条件容器\n    type: shared\n    capability_key: data-table\n`, 'utf8');

    const diff = createDiff(root);
    expect(diff.navigation.changed).toBe(true);
    expect(diff.navigation.added).toEqual(['device_whitelist']);
    expect(diff.routes.changed).toBe(true);
    expect(diff.routes.added).toEqual(['device_whitelist']);
    expect(diff.sharedComponentDiff.changed).toBe(true);
    expect(diff.sharedComponentDiff.removed).toEqual(['MediaSelector', 'PageLayout', 'StatusTag']);
    expect(diff.sharedComponentDiff.added).toEqual([]);
    expect(diff.sharedComponentDiff.capabilityKeys.changed).toBe(true);
    expect(diff.sharedComponentDiff.capabilityKeys.added).toEqual([{ component: 'DataTable', capabilityKey: 'data-table' }, { component: 'SearchForm', capabilityKey: 'data-table' }]);
    expect(diff.sharedComponentDiff.capabilityKeys.duplicates).toEqual(['data-table: DataTable, SearchForm']);
    expect(diff.risks.some((item) => item.code === 'R004')).toBe(true);
    expect(diff.risks.some((item) => item.code === 'R005')).toBe(true);
    expect(diff.risks.some((item) => item.code === 'R011')).toBe(true);
    expect(diff.productModel.map((file) => file.path)).toEqual(['product/navigation.yaml', 'product/routes.yaml']);
    const text = formatDiff(diff);
    expect(text).toContain('NAVIGATION: changed');
    expect(text).toContain('CAPABILITY KEY: changed');
    expect(text).toContain('! duplicate data-table: DataTable, SearchForm');
  });

  it('reports the capability list as undefined when scenarios.yaml is unparsable', () => {
    const root = workspace();
    createFeature(root, 'REQ-DIFF-007', '能力清单结构异常');
    writeScope(root, 'REQ-DIFF-007', '能力清单结构异常', { pages: ['attribution_rule'], paths: ['features/REQ-DIFF-007/**'] });
    writeFileSync(join(root, 'features', 'REQ-DIFF-007', 'scenarios.yaml'), 'list:\n  - id: broken\n    then: 结构无法识别\n', 'utf8');

    const diff = createDiff(root);
    const feature = diff.features.find((item) => item.id === 'REQ-DIFF-007');
    expect(feature?.capabilityCount).toBe(0);
    expect(diff.undefinedRules.filter((item) => item.code === 'U003')).toHaveLength(1);
    expect(diff.undefinedRules.find((item) => item.code === 'U003')?.detail).toContain('结构无法识别');
    // 结构性错误本身由 proto lint 报告；proto diff 只保证不静默（明确写出清单不可解析）
    expect(formatDiff(diff)).toContain('U003');
    expect(formatDiff(diff)).toContain('SCOPE 口径：');
  });

  it('reports Scope BLOCKED with the exact violation codes', () => {
    const root = workspace();
    createFeature(root, 'REQ-DIFF-002', '越界修改');
    writeScope(root, 'REQ-DIFF-002', '越界修改', { paths: ['features/REQ-DIFF-002/**'] });
    append(root, 'README.md', '\n越界\n');
    append(root, 'product/routes.yaml', '  extra_route:\n    path: /extra\n    module: attribution\n');

    const diff = createDiff(root);
    expect(diff.scope.status).toBe('BLOCKED');
    expect(diff.scope.scopeViolations.map((issue) => issue.code).sort()).toEqual(['L001', 'L006']);
    expect(diff.scope.error).toBeNull();
    expect(diff.scope.feature).toBe('REQ-DIFF-002');
    expect(diff.scope.checkedFiles).toBe(diff.changedFiles.length);
    expect(diff.risks.some((item) => item.code === 'R009')).toBe(true);
    expect(diff.undefinedRules.some((item) => item.code === 'U006')).toBe(true);
    expect(diff.productModel.map((file) => file.path)).toEqual(['product/routes.yaml']);
    const text = formatDiff(diff);
    expect(text).toContain('SCOPE: BLOCKED');
    // B5：Scope 结论必须自解释，声明它只覆盖授权判定
    expect(text).toContain('SCOPE 口径：仅判定 Scope 授权（L001 越界 / L006 Product Model 未授权）。结构性、术语、组件登记与 Schema 问题不在本命令判定范围内，请以 proto lint 为准。');
  });
});
