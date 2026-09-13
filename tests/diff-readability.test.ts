import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { createDiff, formatDiff } from '../src/diff.js';
import { git } from '../src/git.js';
import { createFeature, initializeWorkspace } from '../src/workspace.js';

/**
 * Product Diff 可读性 v0.2（PM 30 秒可读）。
 *
 * 验收形态：每一条用户可读的变更描述都是
 *   「<页面或区域的可见名> 的『<按钮/字段的可见名>』：<交互或规则发生了什么>（工程定位：…）」
 * 其中 page id / capability_key / 文件名只允许出现在括号的「工程定位」里，不得占据主句。
 *
 * 可见名取值优先级（与 src/visible-names.ts 一致）：
 *   1. product/pages.yaml（Page Registry）的 name
 *   2. product/navigation.yaml 的 name
 *   3. product/terminology.yaml 的术语 zh_CN
 *   4. 页面 spec / requirement.md / scenarios.yaml 里出现的按钮、字段、区域名
 *   5. 兜底回退为工程标识，并标注「未登记可见名」
 */

const roots: string[] = [];

function workspace(): string {
  const root = mkdtempSync(join(tmpdir(), 'proto-diff-readable-'));
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

function yamlList(values: string[]): string {
  return values.length === 0 ? ' []' : `\n${values.map((value) => `    - ${value}`).join('\n')}`;
}

function writeScope(root: string, id: string, name: string, pages: string[], paths: string[]): void {
  const source = `feature:\n  id: ${id}\n  name: ${name}\n\nallowed:\n  pages:${yamlList(pages)}\n  shared_components: []\n  product_model: []\n  paths:${yamlList(paths)}\n\nforbidden:\n  - product/terminology.yaml\n`;
  writeFileSync(join(root, 'features', id, 'scope.yaml'), source, 'utf8');
}

function append(root: string, path: string, text: string): void {
  writeFileSync(join(root, path), `${readFileSync(join(root, path), 'utf8')}\n${text}\n`, 'utf8');
}

function write(root: string, path: string, text: string): void {
  writeFileSync(join(root, path), text, 'utf8');
}

/** 截取输出中某个段落（从该小标题到之后最早出现的下一个标题）。 */
function section(text: string, heading: string, nextHeadings: string[]): string {
  const start = text.indexOf(heading);
  if (start < 0) return '';
  let end = text.length;
  for (const next of nextHeadings) {
    const at = text.indexOf(next, start + heading.length);
    if (at >= 0 && at < end) end = at;
  }
  return text.slice(start, end);
}

/**
 * 抽取段落里格式为「<标记> <主句>（工程定位：<定位>）」的变更条目行。
 * 只取匹配 given 标记的条目行：Changed Files 的文件清单、段落小标题都不是变更描述。
 */
function itemLines(text: string, heading: string, nextHeadings: string[], marker: RegExp): Array<{ main: string; location: string | null }> {
  const result: Array<{ main: string; location: string | null }> = [];
  for (const line of section(text, heading, nextHeadings).split('\n')) {
    if (!marker.test(line)) continue;
    const at = line.indexOf('（工程定位：');
    if (at < 0) {
      result.push({ main: line.trim(), location: null });
      continue;
    }
    result.push({ main: line.slice(0, at).trim(), location: line.slice(at) });
  }
  return result;
}

const EXPORT_SCENARIOS_V1 = `scenarios:
  - id: export-selected-rules
    given: 归因规则列表存在至少一条规则
    when: 用户点击“导出”
    then: 导出当前筛选结果并给出导出条数
`;

const EXPORT_SCENARIOS_V2 = `scenarios:
  - id: export-selected-rules
    given: 归因规则列表存在至少一条规则
    when: 用户点击“导出”
    then: 导出当前筛选结果，导出条数与文件名一并展示
`;

const EXPORT_REQUIREMENT_V1 = `# 归因规则批量导出

## 用户行为

用户在归因规则列表点击“导出”，导出当前筛选结果。

## 核心规则

- “导出”按钮在列表为空时禁用。
`;

const EXPORT_REQUIREMENT_V2 = `# 归因规则批量导出

## 用户行为

用户在归因规则列表点击“导出”，导出当前筛选结果并展示导出条数。

## 核心规则

- “导出”按钮在列表为空时禁用。
- 导出结果的文件名固定为 attribution-rules.csv。
`;

describe('Product Diff 可读性 v0.2', () => {
  it('主句是「页面可见名 + 按钮可见名 + 交互变化」，page id 只在工程定位里', () => {
    const root = workspace();
    createFeature(root, 'REQ-READ-001', '归因规则批量导出');
    writeScope(root, 'REQ-READ-001', '归因规则批量导出', ['attribution_rule'], ['features/REQ-READ-001/**', 'prototype/src/pages/AttributionRulesPage.tsx']);
    write(root, 'features/REQ-READ-001/requirement.md', EXPORT_REQUIREMENT_V1);
    write(root, 'features/REQ-READ-001/scenarios.yaml', EXPORT_SCENARIOS_V1);
    append(root, 'prototype/src/pages/AttributionRulesPage.tsx', '// 导出按钮');
    append(root, 'specs/attribution_rule.md', '### 导出\n\n把当前筛选结果导出为文件。');
    commit(root, 'feat: export attribution rules');

    const text = formatDiff(createDiff(root));
    // 页面可见名来自 product/pages.yaml 的 name（归因规则），不是 page id（attribution_rule）。
    expect(text).toContain('归因规则 页面的『导出』按钮：导出当前筛选结果并给出导出条数');
    expect(text).not.toContain('attribution_rule 页面的');
    // 旧写法（主语是 capability_key）必须彻底消失
    expect(text).not.toContain('新增 export-selected-rules');
    expect(text).not.toContain('+ 新增 export-selected-rules');
    // CHANGED PAGES 也用可见名当主语
    expect(text).toContain('- 归因规则 页面（工程定位：');
  });

  it('标识符只出现在括号的工程定位里，且一个都不丢', () => {
    const root = workspace();
    // 基线（main）先存在这条能力，本分支把它改掉：vs base 出现「~ 修改」，V1 → latest 出现「旧交互被替换」
    mkdirSync(join(root, 'features', 'REQ-READ-003'), { recursive: true });
    writeScope(root, 'REQ-READ-003', '归因规则批量导出', ['attribution_rule'], ['features/REQ-READ-003/**', 'prototype/src/pages/AttributionRulesPage.tsx']);
    write(root, 'features/REQ-READ-003/requirement.md', EXPORT_REQUIREMENT_V1);
    write(root, 'features/REQ-READ-003/scenarios.yaml', EXPORT_SCENARIOS_V1);
    append(root, 'prototype/src/pages/AttributionRulesPage.tsx', '// 导出');
    commit(root, 'feat: baseline export capability');

    git(root, ['switch', '-c', 'feature/REQ-READ-003']);
    write(root, 'features/REQ-READ-003/requirement.md', EXPORT_REQUIREMENT_V2);
    write(root, 'features/REQ-READ-003/scenarios.yaml', EXPORT_SCENARIOS_V2);
    append(root, 'prototype/src/pages/AttributionRulesPage.tsx', '// 导出条数');
    commit(root, 'feat: show export count');

    const text = formatDiff(createDiff(root), 'main');
    const capabilityItems = itemLines(text, 'CAPABILITIES (vs base', ['REQUIREMENT REPLACEMENTS'], /^ {2}[+~-] /);
    const replacementItems = itemLines(text, 'REQUIREMENT REPLACEMENTS', ['REMOVED ARTIFACTS', 'UNDEFINED RULES', 'RISKS:'], /^- /);
    expect(capabilityItems.length).toBeGreaterThan(0);
    expect(replacementItems.length).toBeGreaterThan(0);

    const identifiers = ['export-selected-rules', 'attribution_rule', 'REQ-READ-003', 'scenarios.yaml', 'requirement.md', 'prototype/src/pages/'];
    for (const item of capabilityItems) {
      // 主句必须是「<页面或区域的可见名> 的『<按钮/字段可见名>』：<变化>」形态
      expect(item.main, item.main).toMatch(/^(?:[+~-]\s*).+页面的『[^』]+』(按钮|入口|字段|勾选框|区域)?：.+$/);
      expect(item.location, item.main).not.toBeNull();
      for (const identifier of identifiers) {
        expect(item.main, `主句不得出现工程标识：${item.main}`).not.toContain(identifier);
      }
      // 工程定位不能因为可读化而丢信息：能力键与来源文件仍在括号里
      expect(item.location).toContain('export-selected-rules');
      expect(item.location).toContain('scenarios.yaml');
      expect(item.location).toContain('REQ-READ-003');
    }
    for (const item of replacementItems) {
      expect(item.main, item.main).toMatch(/^- .+页面的『[^』]+』.+：.+$/);
      expect(item.location).not.toBeNull();
      for (const identifier of identifiers) {
        expect(item.main, `主句不得出现工程标识：${item.main}`).not.toContain(identifier);
      }
      // 工程定位保留「来源文件#条目」，能力键 / 小节名一个都不丢
      expect(item.location).toMatch(/requirement\.md#|scenarios\.yaml#/);
      expect(item.location).toContain('REQ-READ-003');
    }
    expect(replacementItems.some((item) => item.location?.includes('requirement.md#'))).toBe(true);
    expect(replacementItems.some((item) => item.location?.includes('scenarios.yaml#export-selected-rules'))).toBe(true);
    // 修改类条目同样可读，且只说真正变了的字段（V1 与最新版本只有 then 不同）
    expect(text).toContain('归因规则 页面的『导出』按钮：结果由「导出当前筛选结果并给出导出条数」改为「导出当前筛选结果，导出条数与文件名一并展示」');
    // 改动落在 given / when 上时不得输出「同样的话 → 同样的话」
    expect(text).not.toContain('导出当前筛选结果并给出导出条数 → 导出当前筛选结果并给出导出条数');
  });

  it('页面没有登记可见名时回退并明确标注「未登记可见名」', () => {
    const root = workspace();
    // 未登记的页面实现文件：Page Registry 里没有它，navigation.yaml 里也没有它
    createFeature(root, 'REQ-READ-004', '遗留导入页清理');
    writeScope(root, 'REQ-READ-004', '遗留导入页清理', [], ['features/REQ-READ-004/**', 'prototype/src/pages/**']);
    write(root, 'features/REQ-READ-004/requirement.md', '# 遗留导入页清理\n\n## 核心规则\n\n- 系统不做任何改变。\n');
    // 场景文本里没有任何按钮 / 字段 / 区域名：元素名也只能回退
    write(root, 'features/REQ-READ-004/scenarios.yaml', 'scenarios:\n  - id: manual-import-cleanup\n    given: 存在历史导入数据\n    when: 用户不做选择\n    then: 系统不做任何改变\n');
    write(root, 'prototype/src/pages/LegacyImportPage.tsx', 'export const LegacyImportPage = () => null;\n');
    commit(root, 'feat: legacy import page');

    const diff = createDiff(root);
    const text = formatDiff(diff);

    // 1) 页面可见名回退：标注为「未登记可见名」，并给出被回退的工程标识（文件路径）
    expect(text).toContain('（未登记可见名，回退为 prototype/src/pages/LegacyImportPage.tsx）');
    // 2) 元素可见名回退：标注为「未登记可见名」，并给出被回退的工程标识（capability_key）
    expect(text).toContain('『（未登记可见名，回退为 manual-import-cleanup）』');
    // 3) 回退不是「静默降级」：原始能力仍在场景文件里可查，工程定位指向它
    expect(text).toContain('features/REQ-READ-004/scenarios.yaml#manual-import-cleanup');
    // 页面未登记这件事本身仍照常登记为未定义规则（U002），不因为可读化而消失
    expect(diff.undefinedRules.some((rule) => rule.code === 'U002')).toBe(true);
    // JSON 里也能看出这是回退，而不是解析成功的可见名
    const capability = diff.features[0]?.capabilitiesVsBase.added[0];
    expect(capability?.visible?.element.source).toBe('fallback');
    expect(capability?.visible?.element.fallbackOf).toBe('manual-import-cleanup');
    expect(capability?.visible?.page.source).toBe('fallback');
  });

  it('没有 Page Registry 时用 terminology 的术语当页面可见名', () => {
    const root = workspace();
    // 去掉 Page Registry，并把该页面从导航里拿掉：只剩下术语表能给出可见名
    rmSync(join(root, 'product', 'pages.yaml'));
    write(root, 'product/navigation.yaml', 'navigation:\n  - module: overview\n    name: 工作台\n    children:\n      - page: dashboard\n        name: 产品总览\n');
    commit(root, 'chore: drop page registry and navigation entry');

    createFeature(root, 'REQ-READ-005', '归因规则批量导出');
    writeScope(root, 'REQ-READ-005', '归因规则批量导出', [], ['features/REQ-READ-005/**', 'specs/**']);
    write(root, 'features/REQ-READ-005/requirement.md', EXPORT_REQUIREMENT_V1);
    write(root, 'features/REQ-READ-005/scenarios.yaml', EXPORT_SCENARIOS_V1);
    append(root, 'specs/attribution_rule.md', '### 导出\n\n把当前筛选结果导出为文件。');
    commit(root, 'feat: export via terminology name');

    const text = formatDiff(createDiff(root));
    // product/terminology.yaml: attribution_rule → 归因规则
    expect(text).toContain('归因规则 页面的『导出』按钮：导出当前筛选结果并给出导出条数');
    expect(text).not.toContain('attribution_rule 页面的');
  });
});

/**
 * 组件类型词（Drawer / Modal / Dialog / Popover / Dropdown / Table / Tab / Tooltip / Card）是「区域类型」，
 * 不是名字本体。
 *
 * 为什么必须退出主句：用户的原话是「大量疑似前端控件英文名之类的东西，我完全不知道这是一个什么东西」。
 * `Drawer` 对 PM 与 `attribution_rule` 是同一种东西——不知道它是什么。
 * 产品文档里这个区域就叫「版本历史 Drawer」，解析器如果忠实照搬，就把前端控件英文名搬进了主句
 * （协调方复验实测：24 条陈述里唯一不合格的一条就是 `『版本历史 Drawer』区域`，探针残留标识符 `Drawer`）。
 * 正确做法是裁到类型词之前，类型信息改由中文 kind（区域）承载：`『版本历史』区域`。
 */
describe('区域类型词不得进入主句', () => {
  /** 与 tools/readability-probe.mjs 同一判定：去标记 → 剥离括号 → 取冒号前主句 → 找 ASCII 标识符。 */
  function asciiIdentifiers(main: string): string[] {
    const bare = main
      .replace(/^[+~-]\s*/, '')
      .split('：')[0]
      ?.replace(/[（(][^）)]*[）)]/g, ' ') ?? '';
    return (bare.match(/[A-Za-z][A-Za-z0-9_.\-/]{2,}/g) ?? []).filter((token) => /^[A-Za-z][A-Za-z0-9_.\-/]{2,}$/.test(token));
  }

  /**
   * 场景与需求原文的措辞取自真实证据工作区（`REQ-V02-001`）：那个区域在源文档里就叫「版本历史 Drawer」。
   * V1 放在基线（main）上、V2 放在分支上，从而让同一次运行同时产出
   * CAPABILITIES 的 `~ 修改 / + 新增`（路径 A）与 REQUIREMENT REPLACEMENTS 的替换条目（路径 B）。
   */
  const DRAWER_SCENARIOS_V1 = `scenarios:
  - id: compare-result-is-reset-on-reopen
    given: 用户已完成一次与当前版本的对比
    when: 用户关闭并重新打开版本历史 Drawer
    then: 不展示任何上一轮的对比结果
`;

  const DRAWER_SCENARIOS_V2 = `scenarios:
  - id: compare-result-is-reset-on-reopen
    given: 用户已完成一次与当前版本的对比
    when: 用户关闭并重新打开版本历史 Drawer
    then: 关闭并重新打开后不展示上一轮的对比结果
  - id: rule-detail-modal-opens
    given: 至少存在一条归因规则
    when: 用户打开规则详情 Modal
    then: 展示该规则的全部设置与来源
  - id: bare-type-word-name
    given: 存在历史导入数据
    when: 用户打开 Drawer
    then: 不展示任何内容
`;

  const DRAWER_REQUIREMENT_V1 = `# 版本历史对比结果重置

## 用户行为

用户在归因规则列表点击“查看历史版本”。

## 页面变化

- 版本历史 Drawer 只读展示。
`;

  const DRAWER_REQUIREMENT_V2 = `# 版本历史对比结果重置

## 用户行为

用户在归因规则列表点击“查看历史版本”。

## 页面变化

- 版本历史 Drawer 只读展示，并在重新打开时清空上一轮结果。
`;

  it('能力段与替换段共用同一处裁剪：同一个「版本历史 Drawer」在两段里都输出『版本历史』区域', () => {
    const root = workspace();
    mkdirSync(join(root, 'features', 'REQ-READ-006'), { recursive: true });
    writeScope(root, 'REQ-READ-006', '版本历史对比结果重置', ['attribution_rule'], ['features/REQ-READ-006/**', 'prototype/src/pages/AttributionRulesPage.tsx']);
    write(root, 'features/REQ-READ-006/requirement.md', DRAWER_REQUIREMENT_V1);
    write(root, 'features/REQ-READ-006/scenarios.yaml', DRAWER_SCENARIOS_V1);
    append(root, 'prototype/src/pages/AttributionRulesPage.tsx', '// 版本历史区域');
    commit(root, 'feat: baseline drawer scenario');

    git(root, ['switch', '-c', 'feature/REQ-READ-006']);
    write(root, 'features/REQ-READ-006/requirement.md', DRAWER_REQUIREMENT_V2);
    write(root, 'features/REQ-READ-006/scenarios.yaml', DRAWER_SCENARIOS_V2);
    append(root, 'prototype/src/pages/AttributionRulesPage.tsx', '// 对比结果重置');
    commit(root, 'feat: reset compare result on reopen');

    const diff = createDiff(root);
    const text = formatDiff(diff, 'main');
    const capabilityItems = itemLines(text, 'CAPABILITIES (vs base', ['REQUIREMENT REPLACEMENTS', 'REMOVED ARTIFACTS', 'RISKS:'], /^ {2}[+~-] /);
    const replacementItems = itemLines(text, 'REQUIREMENT REPLACEMENTS', ['REMOVED ARTIFACTS', 'UNDEFINED RULES', 'RISKS:'], /^- /);
    expect(capabilityItems.length).toBe(3);
    expect(replacementItems.length).toBe(2);

    // 路径 A：CAPABILITIES 段 —— `~ 修改` 与 `+ 新增` 都要裁掉类型词、类型以中文「区域」保留
    expect(
      capabilityItems.some((item) => item.main === '~ 归因规则 页面的『版本历史』区域：结果由「不展示任何上一轮的对比结果」改为「关闭并重新打开后不展示上一轮的对比结果」'),
      text,
    ).toBe(true);
    expect(capabilityItems.some((item) => item.main === '+ 归因规则 页面的『规则详情』区域：展示该规则的全部设置与来源')).toBe(true);

    // 路径 B：REQUIREMENT REPLACEMENTS 段 —— 同一条能力的替换条目，以及 requirement 小节的替换条目
    const scenarioReplacement = replacementItems.find((item) => item.location?.includes('scenarios.yaml#compare-result-is-reset-on-reopen'));
    const requirementReplacement = replacementItems.find((item) => item.location?.includes('requirement.md#§页面变化'));
    expect(scenarioReplacement, text).toBeDefined();
    expect(requirementReplacement, text).toBeDefined();

    // 关键断言：同一个可见名在两条渲染路径上必须给出完全相同的短语（= 共用同一处裁剪实现，不可能半修）
    for (const item of [scenarioReplacement, requirementReplacement]) {
      expect(item?.main, `替换条目主句：${item?.main}`).toContain('归因规则 页面的『版本历史』区域');
    }

    // 两段逐条机械判定：主句（冒号前）不得残留 ASCII 标识符，也不得出现『…Drawer / Modal…』
    for (const item of [...capabilityItems, ...replacementItems]) {
      expect(asciiIdentifiers(item.main), `主句残留 ASCII 标识符：${item.main}`).toEqual([]);
      expect(item.main, `主句残留组件类型词：${item.main}`).not.toMatch(/『[^』]*(Drawer|Modal|Dialog|Popover|Dropdown|Table|Tab|Tooltip|Card)[^』]*』/);
    }

    // 名字本身就是类型词时不猜：不产生半截名字，走显式兜底并标注
    const bare = capabilityItems.find((item) => item.location?.includes('bare-type-word-name'));
    expect(bare, text).toBeDefined();
    expect(bare?.main).toContain('（未登记可见名，回退为 bare-type-word-name）');
    expect(text).not.toContain('『』');

    // JSON 侧：两条路径拿到的都是裁剪后的名字，类型与工程定位都没丢
    const drawerCapability = diff.features[0]?.capabilitiesVsBase.modified.find((item) => item.id === 'compare-result-is-reset-on-reopen');
    expect(drawerCapability?.after.visible?.element.name).toBe('版本历史');
    expect(drawerCapability?.after.visible?.element.kind).toBe('区域');
    const drawerReplacement = diff.requirementReplacements.find((item) => item.subject === 'compare-result-is-reset-on-reopen');
    expect(drawerReplacement?.visible?.element.name).toBe('版本历史');
    expect(drawerReplacement?.visible?.element.kind).toBe('区域');
    expect(drawerReplacement?.visible?.element.source).toBe('spec');
    expect(text).toContain('features/REQ-READ-006/scenarios.yaml#compare-result-is-reset-on-reopen');
  });
});
