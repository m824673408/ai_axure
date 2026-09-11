import { spawnSync } from 'node:child_process';
import { existsSync, readFileSync } from 'node:fs';
import { basename, join } from 'node:path';
import YAML from 'yaml';
import { changedFiles, currentBranch, currentFeature, fullDiff, git } from './git.js';
import { normalizePath, pathKey } from './io.js';
import { duplicateCapabilityKeys, loadComponentRegistry, loadPageRegistry, pageIdForFile } from './registry.js';
import { authorizePath, isProductPath } from './scope.js';
import { loadConfig, loadProduct, loadScope } from './workspace.js';
import type { ChangedFile, NavigationItem, ScopeModel } from './types.js';
import type { PageRegistry } from './registry.js';

/**
 * Product Diff 的全部结论都来自 Git 对象与工作区文件的确定性读取：
 * 不使用 LLM、不访问网络、不依赖执行时间与本地化设置。
 * 为控制进程开销，所有 `<ref>:<path>` 读取合并为一次 `git cat-file --batch`。
 */

export const CONTRACT_VERSION = '1';

// ---------------------------------------------------------------------------
// 输出合同（Studio / CI 消费；只新增字段，不改变既有字段语义）
// ---------------------------------------------------------------------------

export interface DiffFinding {
  code: string;
  title: string;
  detail: string;
  file?: string;
}

export interface DiffClassification {
  total: number;
  categorized: number;
  uncategorized: string[];
  assigned: Record<string, string>;
  overlaps: string[];
}

export interface ChangedPage {
  product: string;
  pageId: string | null;
  name: string | null;
  route: string | null;
  mapping: 'registry' | 'app' | 'page-id' | 'normalized' | 'spec' | 'pages' | 'unmapped';
  known: boolean;
  files: string[];
  features: string[];
}

export interface CapabilityRef {
  id: string;
  feature: string;
  given: string;
  when: string;
  then: string;
}

export interface CapabilityChange {
  added: CapabilityRef[];
  removed: CapabilityRef[];
  modified: Array<{ id: string; feature: string; before: CapabilityRef; after: CapabilityRef }>;
}

export interface RequirementReplacement {
  kind: 'removed' | 'replaced';
  feature: string;
  source: string;
  subject: string;
  before: string | null;
  after: string | null;
  message: string;
}

export interface RemovedArtifact {
  feature: string;
  path: string;
  introducedBy: string;
  removedBy: string;
  message: string;
}

export interface FeatureRevisionDiff {
  from: string;
  fromKind: 'introducing-commit' | 'base';
  to: string;
  revisionCount: number;
  nameBefore: string | null;
  nameAfter: string;
  capabilities: CapabilityChange;
  replacements: RequirementReplacement[];
  removedArtifacts: RemovedArtifact[];
}

export interface FeatureImpact {
  id: string;
  name: string;
  origin: 'branch' | 'files';
  status: 'added' | 'modified' | 'removed' | 'unchanged';
  files: string[];
  changedPages: string[];
  capabilityCount: number;
  capabilitiesVsBase: CapabilityChange;
  revision: FeatureRevisionDiff;
}

export interface NavigationDiff {
  changed: boolean;
  added: string[];
  removed: string[];
  modified: Array<{ page: string; before: string; after: string }>;
}

export interface RouteDiff {
  changed: boolean;
  added: string[];
  removed: string[];
  modified: Array<{ id: string; before: string; after: string }>;
}

export interface CapabilityKeyDiff {
  changed: boolean;
  added: Array<{ component: string; capabilityKey: string }>;
  removed: Array<{ component: string; capabilityKey: string }>;
  modified: Array<{ component: string; before: string | null; after: string | null }>;
  duplicates: string[];
}

export interface SharedComponentDiff {
  changed: boolean;
  added: string[];
  removed: string[];
  modified: string[];
  capabilityKeys: CapabilityKeyDiff;
}

export interface ScopeEvaluation {
  status: 'PASS' | 'BLOCKED';
  feature: string | null;
  checkedFiles: number;
  scopeViolations: Array<{ code: 'L001' | 'L006'; file: string; message: string }>;
  error: string | null;
}

export interface ProductDiff {
  contractVersion: string;
  changedFiles: ChangedFile[];
  productModel: ChangedFile[];
  pages: ChangedFile[];
  sharedComponents: ChangedFile[];
  featureFiles: ChangedFile[];
  prototypeFiles: ChangedFile[];
  otherFiles: ChangedFile[];
  classification: DiffClassification;
  product: { id: string; name: string; version: string };
  features: FeatureImpact[];
  changedPages: ChangedPage[];
  navigation: NavigationDiff;
  routes: RouteDiff;
  sharedComponentDiff: SharedComponentDiff;
  scope: ScopeEvaluation;
  requirementReplacements: RequirementReplacement[];
  removedArtifacts: RemovedArtifact[];
  undefinedRules: DiffFinding[];
  risks: DiffFinding[];
}

// ---------------------------------------------------------------------------
// 内部类型
// ---------------------------------------------------------------------------

type Category = 'featureFiles' | 'productModel' | 'sharedComponents' | 'pages' | 'prototypeFiles' | 'otherFiles';

interface Revision {
  hash: string;
  short: string;
  subject: string;
  files: ChangedFile[];
}

interface RawScenario {
  id: string;
  given: string;
  when: string;
  then: string;
}

interface PageIndex {
  ids: string[];
  names: Map<string, string>;
  routes: Map<string, string>;
  appStems: Map<string, string>;
  /** P0-3 Page Registry（存在时优先用于「实现文件 / spec → page id」映射）。 */
  registry: PageRegistry;
  specToPage: Map<string, string>;
}

interface ArtifactCandidate {
  feature: string;
  path: string;
  introducedBy: string;
  removedBy: string;
}

/** `<ref>:<path>` 读取器：优先命中批量预取结果，未预取的键回退为单次 git show。 */
interface BlobReader {
  at(ref: string, path: string): string | null;
  latest(path: string): string | null;
  base(path: string): string | null;
}

interface FeatureContext {
  root: string;
  current: string | null;
  featureFiles: ChangedFile[];
  files: ChangedFile[];
  attribution: Map<string, string[]>;
  pageIndex: PageIndex;
  reader: BlobReader;
}

/** 分类规则按优先级排列：每个文件只进入第一个命中的类别，保证互斥且总数正确。 */
const CATEGORY_RULES: Array<[Exclude<Category, 'otherFiles'>, (path: string) => boolean]> = [
  ['featureFiles', (path) => path.startsWith('features/')],
  ['productModel', (path) => path.startsWith('product/')],
  ['sharedComponents', (path) => path.startsWith('components/shared/') || path.startsWith('prototype/src/components/shared/')],
  ['pages', (path) => path.startsWith('pages/') || path.startsWith('specs/') || path.includes('/pages/')],
  ['prototypeFiles', (path) => path.startsWith('prototype/')],
];

function compareText(a: string, b: string): number {
  return a < b ? -1 : a > b ? 1 : 0;
}

function sorted(values: Iterable<string>): string[] {
  return [...values].sort(compareText);
}

// ---------------------------------------------------------------------------
// Git 读取
// ---------------------------------------------------------------------------

function resolveBaseRef(root: string, baseBranch: string): string {
  return git(root, ['merge-base', baseBranch, 'HEAD'], true) || baseBranch;
}

function parseStatusLine(line: string): ChangedFile | null {
  const parts = line.split('\t').map((part) => part.trim()).filter(Boolean);
  const raw = parts[0] ?? '';
  if (!raw) return null;
  const path = raw.startsWith('R') ? parts[2] : parts[1];
  if (!path) return null;
  return { status: raw[0] as ChangedFile['status'], path: normalizePath(path) };
}

/** 读取 base..HEAD 的非合并提交（含每个提交的 name-status），按时间正序。 */
function readRevisions(root: string, base: string): Revision[] {
  const output = git(root, ['log', '--reverse', '--no-merges', '--name-status', '--format=%x00%H%x1f%h%x1f%s', `${base}..HEAD`], true);
  if (!output) return [];
  const revisions: Revision[] = [];
  for (const block of output.split('\0')) {
    const text = block.trim();
    if (!text) continue;
    const [header = '', ...rest] = text.split(/\r?\n/);
    const [hash = '', short = '', ...subjectParts] = header.split('\x1f');
    if (!hash) continue;
    const files: ChangedFile[] = [];
    for (const line of rest) {
      const file = parseStatusLine(line);
      if (file) files.push(file);
    }
    revisions.push({ hash, short: short || hash.slice(0, 7), subject: subjectParts.join('\x1f'), files });
  }
  return revisions;
}

/** 一次 `git cat-file --batch` 完成全部 `<ref>:<path>` 读取，避免每个文件一次进程开销。 */
function readBlobs(root: string, requests: Array<{ ref: string; path: string }>): Map<string, string | null> {
  const values = new Map<string, string | null>();
  const unique: Array<{ key: string; spec: string }> = [];
  const seen = new Set<string>();
  for (const item of requests) {
    const key = `${item.ref}:${normalizePath(item.path)}`;
    if (seen.has(key)) continue;
    seen.add(key);
    unique.push({ key, spec: key });
  }
  if (unique.length === 0) return values;
  const result = spawnSync('git', ['cat-file', '--batch'], { cwd: root, input: Buffer.from(`${unique.map((item) => item.spec).join('\n')}\n`, 'utf8'), maxBuffer: 64 * 1024 * 1024 });
  const output = result.stdout;
  if (result.status !== 0 || !output) {
    for (const item of unique) values.set(item.key, null);
    return values;
  }
  let offset = 0;
  for (const item of unique) {
    const lineEnd = output.indexOf(0x0a, offset);
    if (lineEnd < 0) {
      values.set(item.key, null);
      continue;
    }
    const header = output.subarray(offset, lineEnd).toString('utf8');
    offset = lineEnd + 1;
    const match = /^[0-9a-f]+ \w+ (\d+)$/.exec(header);
    const size = match?.[1] ? Number(match[1]) : null;
    if (size === null) {
      values.set(item.key, null);
      continue;
    }
    values.set(item.key, output.subarray(offset, offset + size).toString('utf8'));
    offset += size + 1;
  }
  return values;
}

function createBlobReader(root: string, blobs: Map<string, string | null>, baseRef: () => string, changedStatus: Map<string, ChangedFile['status']>): BlobReader {
  const at = (ref: string, path: string): string | null => {
    const key = `${ref}:${normalizePath(path)}`;
    if (blobs.has(key)) return blobs.get(key) ?? null;
    return git(root, ['show', key], true) || null;
  };
  const latest = (path: string): string | null => {
    const full = join(root, normalizePath(path));
    if (existsSync(full)) return readFileSync(full, 'utf8');
    return at('HEAD', path);
  };
  const base = (path: string): string | null => {
    // changedFiles 已经给出相对 merge-base 的净差：未出现在净差里的文件与 base 完全相同。
    const normalized = normalizePath(path);
    const status = changedStatus.get(normalized);
    if (status === undefined) return latest(normalized);
    if (status === 'A' || status === 'U') return null;
    return at(baseRef(), normalized);
  };
  return { at, latest, base };
}

/** 该 Feature 是否由本分支的某个提交新引入（用于确定 V1 参照点，无需读取 base 对象）。 */
function introducedByBranch(history: Revision[], id: string): Revision | null {
  const first = history[0];
  if (!first) return null;
  const anchors = new Set([`features/${id}/requirement.md`, `features/${id}/scope.yaml`]);
  const added = first.files.some((file) => anchors.has(file.path) && file.status === 'A');
  return added ? first : null;
}

// ---------------------------------------------------------------------------
// 工作区模型读取（缺文件时降级为 null，并登记“未定义规则”）
// ---------------------------------------------------------------------------

function parseYamlText<T>(text: string | null): T | null {
  if (text === null || text.trim() === '') return null;
  try {
    return YAML.parse(text) as T;
  } catch {
    return null;
  }
}

function flattenNavigation(items: NavigationItem[], module: string | null = null): Array<{ page: string; name: string; module: string | null }> {
  const result: Array<{ page: string; name: string; module: string | null }> = [];
  for (const item of items) {
    const current = item.module ?? module;
    if (item.page) result.push({ page: item.page, name: item.name, module: current });
    result.push(...flattenNavigation(item.children ?? [], current));
  }
  return result;
}

function parseNavigationEntries(text: string | null): Array<{ page: string; name: string; module: string | null }> {
  const model = parseYamlText<{ navigation?: NavigationItem[] }>(text);
  return flattenNavigation(Array.isArray(model?.navigation) ? model.navigation : []);
}

function parseRoutes(text: string | null): Map<string, string> {
  const model = parseYamlText<{ routes?: Record<string, { path?: string; module?: string }> }>(text);
  const routes = new Map<string, string>();
  for (const [id, route] of Object.entries(model?.routes ?? {})) {
    routes.set(id, `${route?.path ?? ''} (${route?.module ?? '-'})`);
  }
  return routes;
}

function parseRegistry(text: string | null): Map<string, string | null> {
  const model = parseYamlText<{ components?: Record<string, { capability_key?: unknown }> }>(text);
  const entries = new Map<string, string | null>();
  for (const [id, value] of Object.entries(model?.components ?? {})) {
    const key = value?.capability_key;
    entries.set(id, typeof key === 'string' ? key : null);
  }
  return entries;
}

function parseScenarios(text: string | null): RawScenario[] {
  const model = parseYamlText<{ scenarios?: unknown }>(text);
  const list = Array.isArray(model?.scenarios) ? model.scenarios : [];
  const scenarios: RawScenario[] = [];
  for (const [index, item] of list.entries()) {
    if (typeof item !== 'object' || item === null) continue;
    const record = item as Record<string, unknown>;
    scenarios.push({
      id: typeof record.id === 'string' && record.id ? record.id : `#${index + 1}`,
      given: typeof record.given === 'string' ? record.given : '',
      when: typeof record.when === 'string' ? record.when : '',
      then: typeof record.then === 'string' ? record.then : '',
    });
  }
  return scenarios;
}

function featureName(text: string | null, fallback: string): string {
  const model = parseYamlText<{ feature?: { name?: unknown } }>(text);
  const name = model?.feature?.name;
  return typeof name === 'string' && name ? name : fallback;
}

// ---------------------------------------------------------------------------
// 页面 ID 索引：产品导航 + 路由 + prototype/src/App.tsx 的显式页面映射
// ---------------------------------------------------------------------------

function appStemMap(source: string): Map<string, string> {
  const stems = new Map<string, string>();
  const components = new Map<string, string>();
  for (const match of source.matchAll(/const\s+([A-Za-z0-9_$]+)\s*=\s*lazy\(\s*\(\)\s*=>\s*import\(\s*['"]\.\/pages\/([^'"]+)['"]\s*\)\s*\)/g)) {
    const name = match[1];
    const file = match[2];
    if (name && file) components.set(name, basename(normalizePath(file)).replace(/\.(tsx?|jsx?)$/, ''));
  }
  const body = source.match(/const\s+pages\b[^=]*=\s*\{([\s\S]*?)\n\};/);
  if (!body?.[1]) return stems;
  for (const match of body[1].matchAll(/(?:^|\n)\s*([A-Za-z0-9_$]+)\s*:\s*<\s*([A-Za-z0-9_$]+)\s*\/>/g)) {
    const pageId = match[1];
    const component = match[2];
    if (!pageId || !component) continue;
    const stem = components.get(component);
    if (stem) stems.set(stem, pageId);
  }
  return stems;
}

function buildPageIndex(root: string, reader: BlobReader): PageIndex {
  const registry = loadPageRegistry(root);
  const entries = parseNavigationEntries(reader.latest('product/navigation.yaml'));
  const routes = parseRoutes(reader.latest('product/routes.yaml'));
  const app = reader.latest('prototype/src/App.tsx');
  const names = new Map<string, string>();
  const specToPage = new Map<string, string>();
  // P0-3 Registry 存在时优先：page id、名称与 spec 都由 Registry 给出。
  for (const [id, entry] of registry.entries) {
    names.set(id, entry.name);
    if (entry.spec) specToPage.set(pathKey(entry.spec), id);
  }
  for (const entry of entries) if (!names.has(entry.page)) names.set(entry.page, entry.name);
  return { ids: sorted(names.keys()), names, routes, appStems: app ? appStemMap(app) : new Map(), registry, specToPage };
}

/** 去掉页面文件名的语义后缀与大小写/复数差异，用于无显式映射时的确定性回退匹配。 */
function normalizeStem(value: string): string {
  return value
    .replace(/Page$/, '')
    .replace(/([a-z0-9])([A-Z])/g, '$1_$2')
    .replace(/[^A-Za-z0-9]+/g, '_')
    .replace(/_+$/, '')
    .toLowerCase()
    .replace(/s$/, '');
}

function resolvePageFile(path: string, index: PageIndex): { pageId: string | null; mapping: ChangedPage['mapping'] } {
  const registered = pageIdForFile(index.registry, path);
  if (registered) return { pageId: registered, mapping: 'registry' };
  const stem = basename(normalizePath(path)).replace(/\.(tsx?|jsx?|md)$/, '');
  const explicit = index.appStems.get(stem);
  if (explicit) return { pageId: explicit, mapping: 'app' };
  if (index.ids.includes(stem)) return { pageId: stem, mapping: 'page-id' };
  const normalizedStem = normalizeStem(stem);
  const match = index.ids.filter((id) => normalizeStem(id) === normalizedStem);
  if (match.length === 1) return { pageId: match[0] ?? null, mapping: 'normalized' };
  return { pageId: null, mapping: 'unmapped' };
}

function pageOfPath(path: string, index: PageIndex): { pageId: string | null; mapping: ChangedPage['mapping'] } | null {
  const normalized = normalizePath(path);
  if (normalized.startsWith('specs/') && normalized.endsWith('.md')) {
    const registered = index.specToPage.get(pathKey(normalized));
    if (registered) return { pageId: registered, mapping: 'registry' };
    const derived = basename(normalized).replace(/\.md$/, '');
    // B6：Registry 存在且该 spec 未登记、stem 也不是产品模型中真实的 page id 时，不得凭文件名造出“幻影页”。
    if (index.registry.present && !index.ids.includes(derived)) return { pageId: null, mapping: 'unmapped' };
    return { pageId: derived, mapping: 'spec' };
  }
  if (normalized.startsWith('pages/')) {
    const [first = ''] = normalized.slice('pages/'.length).split('/');
    const derived = first.replace(/\.(md|tsx?|jsx?)$/, '');
    if (!derived) return null;
    if (index.registry.present && !index.ids.includes(derived)) return { pageId: null, mapping: 'unmapped' };
    return { pageId: derived, mapping: 'pages' };
  }
  if (normalized.startsWith('prototype/src/pages/')) return resolvePageFile(normalized, index);
  return null;
}

// ---------------------------------------------------------------------------
// Feature 识别与归属
// ---------------------------------------------------------------------------
// Feature 识别与归属
// ---------------------------------------------------------------------------

function featureIdFromPath(path: string): string | null {
  return normalizePath(path).match(/^features\/([^/]+)\//)?.[1] ?? null;
}

function buildAttribution(revisions: Revision[], files: ChangedFile[], scopes: Map<string, ScopeModel>, pages: PageRegistry): Map<string, string[]> {
  const owners = new Map<string, string[]>();
  const assign = (path: string, featureId: string) => {
    const list = owners.get(path) ?? [];
    if (!list.includes(featureId)) list.push(featureId);
    owners.set(path, sorted(list));
  };
  for (const revision of revisions) {
    const revisionFeatures = new Set<string>();
    for (const file of revision.files) {
      const id = featureIdFromPath(file.path);
      if (id) revisionFeatures.add(id);
    }
    // 只有在提交只对应一个 Feature 时才做归属，避免把并发工作的提交算到别人头上。
    if (revisionFeatures.size !== 1) continue;
    const featureId = [...revisionFeatures][0];
    if (!featureId) continue;
    for (const file of revision.files) assign(file.path, featureId);
  }
  for (const file of files) {
    const id = featureIdFromPath(file.path);
    if (id) assign(file.path, id);
  }
  for (const file of files) {
    if (owners.has(file.path)) continue;
    // 未提交变更或与 Feature 目录无关的提交：用 scope 授权做确定性回退归属。
    const allowed = [...scopes.entries()].filter(([, scope]) => authorizePath(file.path, scope, pages).allowed).map(([id]) => id);
    if (allowed.length === 1 && allowed[0]) assign(file.path, allowed[0]);
  }
  return owners;
}

/** 在某个 Feature 的提交历史中“先新增、后被删除、最终不存在”的文件（净零变更，base..HEAD 净差看不到）。 */
function artifactCandidates(root: string, feature: string, revisions: Revision[]): ArtifactCandidate[] {
  const lifetime = new Map<string, { introduced?: Revision; removed?: Revision }>();
  for (const revision of revisions) {
    for (const file of revision.files) {
      const record = lifetime.get(file.path) ?? {};
      if ((file.status === 'A' || file.status === 'U') && !record.introduced) record.introduced = revision;
      if (file.status === 'D') record.removed = revision;
      lifetime.set(file.path, record);
    }
  }
  const candidates: ArtifactCandidate[] = [];
  for (const path of sorted(lifetime.keys())) {
    const record = lifetime.get(path);
    if (!record?.introduced || !record.removed) continue;
    if (existsSync(join(root, path))) continue;
    candidates.push({ feature, path, introducedBy: record.introduced.short, removedBy: record.removed.short });
  }
  return candidates;
}

// ---------------------------------------------------------------------------
// 能力与需求替换关系
// ---------------------------------------------------------------------------

function toCapabilityRef(scenario: RawScenario, feature: string): CapabilityRef {
  return { id: scenario.id, feature, given: scenario.given, when: scenario.when, then: scenario.then };
}

function sameScenario(a: RawScenario, b: RawScenario): boolean {
  return a.given === b.given && a.when === b.when && a.then === b.then;
}

function diffCapabilities(before: RawScenario[], after: RawScenario[], feature: string): CapabilityChange {
  const beforeMap = new Map(before.map((item) => [item.id, item]));
  const afterMap = new Map(after.map((item) => [item.id, item]));
  const added: CapabilityRef[] = [];
  const removed: CapabilityRef[] = [];
  const modified: CapabilityChange['modified'] = [];
  for (const id of sorted(afterMap.keys())) {
    const item = afterMap.get(id);
    if (item && !beforeMap.has(id)) added.push(toCapabilityRef(item, feature));
  }
  for (const id of sorted(beforeMap.keys())) {
    const item = beforeMap.get(id);
    if (item && !afterMap.has(id)) removed.push(toCapabilityRef(item, feature));
  }
  for (const id of sorted(afterMap.keys())) {
    const afterItem = afterMap.get(id);
    const beforeItem = beforeMap.get(id);
    if (!afterItem || !beforeItem || sameScenario(beforeItem, afterItem)) continue;
    modified.push({ id, feature, before: toCapabilityRef(beforeItem, feature), after: toCapabilityRef(afterItem, feature) });
  }
  return { added, removed, modified };
}

function splitSections(text: string): Map<string, string[]> {
  const sections = new Map<string, string[]>([['(前言)', []]]);
  let current = '(前言)';
  for (const line of text.split(/\r?\n/)) {
    const heading = line.match(/^##\s+(.+?)\s*$/);
    if (heading?.[1]) {
      current = heading[1];
      if (!sections.has(current)) sections.set(current, []);
      continue;
    }
    sections.get(current)?.push(line);
  }
  return sections;
}

function meaningfulLines(lines: string[]): string[] {
  return lines.map((line) => line.trim()).filter(Boolean);
}

/** requirement.md 的 V1 → 最新版本替换关系：只报告“旧内容被移除”的小节，避免把纯新增当成反悔。 */
function requirementReplacements(feature: string, beforeText: string | null, afterText: string | null): RequirementReplacement[] {
  if (beforeText === null || afterText === null) return [];
  const beforeSections = splitSections(beforeText);
  const afterSections = splitSections(afterText);
  const replacements: RequirementReplacement[] = [];
  for (const name of sorted(new Set([...beforeSections.keys(), ...afterSections.keys()]))) {
    const beforeLines = meaningfulLines(beforeSections.get(name) ?? []);
    const afterLines = meaningfulLines(afterSections.get(name) ?? []);
    const removed = beforeLines.filter((line) => !afterLines.includes(line));
    if (removed.length === 0) continue;
    const added = afterLines.filter((line) => !beforeLines.includes(line));
    replacements.push({
      kind: added.length > 0 ? 'replaced' : 'removed',
      feature,
      source: `features/${feature}/requirement.md`,
      subject: `§${name}`,
      before: removed.join(' / '),
      after: added.length > 0 ? added.join(' / ') : null,
      message: added.length > 0
        ? `旧交互被移除/替换：需求文档 ${name} 小节的 V1 描述已被最新版本替换。`
        : `旧交互被移除：需求文档 ${name} 小节的 V1 描述在最新版本中已不存在。`,
    });
  }
  return replacements;
}

/** scenarios.yaml 的 V1 → 最新版本替换关系。 */
function scenarioReplacements(feature: string, change: CapabilityChange): RequirementReplacement[] {
  const source = `features/${feature}/scenarios.yaml`;
  const text = (capability: CapabilityRef) => `given: ${capability.given} / when: ${capability.when} / then: ${capability.then}`;
  const replacements: RequirementReplacement[] = [];
  for (const item of change.removed) {
    replacements.push({
      kind: 'removed',
      feature,
      source,
      subject: item.id,
      before: text(item),
      after: null,
      message: `旧交互被移除：V1 能力 ${item.id}（${item.then}）在最新版本中已不存在。`,
    });
  }
  for (const item of change.modified) {
    const parts: string[] = [];
    if (item.before.given !== item.after.given) parts.push(`given 由「${item.before.given}」改为「${item.after.given}」`);
    if (item.before.when !== item.after.when) parts.push(`when 由「${item.before.when}」改为「${item.after.when}」`);
    if (item.before.then !== item.after.then) parts.push(`then 由「${item.before.then}」改为「${item.after.then}」`);
    replacements.push({
      kind: 'replaced',
      feature,
      source,
      subject: item.id,
      before: text(item.before),
      after: text(item.after),
      message: `旧交互被替换：能力 ${item.id} 的 ${parts.join('；')}。`,
    });
  }
  return replacements;
}

// ---------------------------------------------------------------------------
// 主入口
// ---------------------------------------------------------------------------

export function createDiff(root: string): ProductDiff {
  const config = loadConfig(root);
  const baseBranch = config.workspace.base_branch;
  const files = changedFiles(root, baseBranch);
  const undefinedRules: DiffFinding[] = [];
  const risks: DiffFinding[] = [];

  let resolvedBase: string | null = null;
  /** merge-base 只在确实需要读取 base 侧 Git 对象时才解析，避免每次 diff 多一次进程开销。 */
  const baseRef = (): string => (resolvedBase ??= resolveBaseRef(root, baseBranch));

  const groups: Record<Category, ChangedFile[]> = {
    featureFiles: [], productModel: [], sharedComponents: [], pages: [], prototypeFiles: [], otherFiles: [],
  };
  const assigned: Record<string, string> = {};
  const overlaps: string[] = [];
  for (const file of files) {
    const matched = CATEGORY_RULES.filter(([, match]) => match(file.path)).map(([key]) => key);
    if (matched.length > 1) overlaps.push(file.path);
    const key: Category = matched[0] ?? 'otherFiles';
    groups[key].push(file);
    assigned[file.path] = key;
  }

  const product = readProductIdentity(root, undefinedRules);
  // `main..HEAD` 与本分支自 merge-base 起的提交集合一致，且不依赖额外解析 merge-base。
  const revisions = readRevisions(root, baseBranch);

  let current: string | null = null;
  try {
    current = currentFeature(root);
  } catch {
    current = null;
  }

  const featureIds = new Set<string>();
  for (const file of files) {
    const id = featureIdFromPath(file.path);
    if (id) featureIds.add(id);
  }
  for (const revision of revisions) {
    for (const file of revision.files) {
      const id = featureIdFromPath(file.path);
      if (id) featureIds.add(id);
    }
  }
  if (current) featureIds.add(current);
  const ids = sorted(featureIds);

  const changedStatus = new Map<string, ChangedFile['status']>();
  for (const file of files) changedStatus.set(file.path, file.status);
  const missingInWorktree = (path: string) => !existsSync(join(root, normalizePath(path)));
  /** 只有“相对 base 被修改/删除/重命名”的文件才需要读 base 对象；新增文件在 base 中必然不存在。 */
  const needsBaseObject = (path: string) => {
    const status = changedStatus.get(path);
    return status !== undefined && status !== 'A' && status !== 'U';
  };

  const revisionHistory = new Map<string, Revision[]>();
  const revisionFrom = new Map<string, string>();
  const revisionFromKind = new Map<string, FeatureRevisionDiff['fromKind']>();
  const candidates = new Map<string, ArtifactCandidate[]>();
  const requests: Array<{ ref: string; path: string }> = [];
  const basePaths: string[] = [];
  const request = (ref: string, path: string) => {
    requests.push({ ref, path: normalizePath(path) });
  };
  for (const path of ['product/navigation.yaml', 'product/routes.yaml', 'components/registry.yaml']) {
    if (needsBaseObject(path)) basePaths.push(path);
  }
  if (missingInWorktree('prototype/src/App.tsx')) request('HEAD', 'prototype/src/App.tsx');
  for (const id of ids) {
    const history = revisions.filter((revision) => revision.files.some((file) => featureIdFromPath(file.path) === id));
    revisionHistory.set(id, history);
    const introduced = introducedByBranch(history, id);
    const fromKind: FeatureRevisionDiff['fromKind'] = introduced ? 'introducing-commit' : 'base';
    revisionFromKind.set(id, fromKind);
    revisionFrom.set(id, introduced ? introduced.hash : baseBranch);
    candidates.set(id, artifactCandidates(root, id, history));
    for (const name of ['scope.yaml', 'requirement.md', 'scenarios.yaml']) {
      const path = `features/${id}/${name}`;
      // 引入提交本身：三个文件都在该提交中存在；否则只有“相对 base 被修改/删除”的文件才需要读 Git 对象。
      if (introduced) request(introduced.hash, path);
      else if (needsBaseObject(path)) basePaths.push(path);
      if (missingInWorktree(path)) request('HEAD', path);
    }
    for (const candidate of candidates.get(id) ?? []) request('HEAD', candidate.path);
  }
  if (basePaths.length > 0) {
    const ref = baseRef();
    for (const path of basePaths) request(ref, path);
  }
  const blobs = readBlobs(root, requests);
  const reader = createBlobReader(root, blobs, baseRef, changedStatus);

  const pageIndex = buildPageIndex(root, reader);

  const scopes = new Map<string, ScopeModel>();
  for (const id of ids) {
    try {
      const scope = loadScope(root, id);
      if (scope) scopes.set(id, scope);
    } catch {
      // 无 scope.yaml 只影响归属回退，不影响确定性输出。
    }
  }
  const attribution = buildAttribution(revisions, files, scopes, pageIndex.registry);

  const context: FeatureContext = { root, current, featureFiles: groups.featureFiles, files, attribution, pageIndex, reader };
  const features = ids.map((id) => buildFeatureImpact(context, id, revisionHistory.get(id) ?? [], revisionFrom.get(id) ?? baseBranch, revisionFromKind.get(id) ?? 'base', candidates.get(id) ?? []));

  const changedPages = buildChangedPages(files, product.name, pageIndex, attribution, undefinedRules);
  const navigation = buildNavigationDiff(files, reader);
  const routes = buildRouteDiff(files, reader);
  const sharedComponentDiff = buildSharedComponentDiff(root, files, groups.sharedComponents, reader);
  const scope = evaluateScope(root, files, current, pageIndex.registry);

  const requirementReplacements = features.flatMap((feature) => feature.revision.replacements).sort((a, b) => compareText(`${a.source}#${a.subject}`, `${b.source}#${b.subject}`));
  const removedArtifacts = features.flatMap((feature) => feature.revision.removedArtifacts).sort((a, b) => compareText(a.path, b.path));

  collectFindings({ files, features, changedPages, sharedComponentDiff, scope, navigation, routes, undefinedRules, risks });

  return {
    contractVersion: CONTRACT_VERSION,
    changedFiles: files,
    productModel: groups.productModel,
    pages: groups.pages,
    sharedComponents: groups.sharedComponents,
    featureFiles: groups.featureFiles,
    prototypeFiles: groups.prototypeFiles,
    otherFiles: groups.otherFiles,
    classification: {
      total: files.length,
      categorized: files.length - groups.otherFiles.length,
      uncategorized: groups.otherFiles.map((file) => file.path),
      assigned,
      overlaps: sorted(overlaps),
    },
    product,
    features,
    changedPages,
    navigation,
    routes,
    sharedComponentDiff,
    scope,
    requirementReplacements,
    removedArtifacts,
    undefinedRules: [...undefinedRules].sort((a, b) => compareText(a.code, b.code)),
    risks: [...risks].sort((a, b) => compareText(a.code, b.code)),
  };
}

function readProductIdentity(root: string, undefinedRules: DiffFinding[]): ProductDiff['product'] {
  try {
    const identity = loadProduct(root).product;
    return { id: identity.id, name: identity.name, version: identity.version };
  } catch {
    undefinedRules.push({ code: 'U007', title: '产品名未定义', detail: '无法读取 product/product.yaml，Changed Pages 中的产品名为空。', file: 'product/product.yaml' });
    return { id: '', name: '', version: '' };
  }
}

function buildFeatureImpact(
  context: FeatureContext,
  id: string,
  featureRevisions: Revision[],
  from: string,
  fromKind: FeatureRevisionDiff['fromKind'],
  artifactCandidatesOfFeature: ArtifactCandidate[],
): FeatureImpact {
  const { reader, pageIndex, attribution, files, current } = context;  const own = context.featureFiles.filter((file) => featureIdFromPath(file.path) === id);
  const statuses = new Set(own.map((file) => file.status));
  const status: FeatureImpact['status'] = own.length === 0
    ? 'unchanged'
    : [...statuses].every((value) => value === 'D')
      ? 'removed'
      : [...statuses].every((value) => value === 'A' || value === 'U')
        ? 'added'
        : 'modified';

  const attributed = files.filter((file) => attribution.get(file.path)?.includes(id)).map((file) => file.path);
  /** V1 侧读取：引入提交直接从该提交读取，否则读取 base 侧（与 base 相同的文件直接复用工作区内容）。 */
  const before = (name: string): string | null => fromKind === 'introducing-commit'
    ? reader.at(from, `features/${id}/${name}`)
    : reader.base(`features/${id}/${name}`);
  const nameAfter = featureName(reader.latest(`features/${id}/scope.yaml`), id);
  const nameBefore = featureName(before('scope.yaml'), fromKind === 'base' ? id : nameAfter);

  const scenariosAfter = parseScenarios(reader.latest(`features/${id}/scenarios.yaml`));
  const revisionCapabilities = diffCapabilities(parseScenarios(before('scenarios.yaml')), scenariosAfter, id);
  const baseCapabilities = diffCapabilities(parseScenarios(reader.base(`features/${id}/scenarios.yaml`)), scenariosAfter, id);

  const replacements = [
    ...scenarioReplacements(id, revisionCapabilities),
    ...requirementReplacements(id, before('requirement.md'), reader.latest(`features/${id}/requirement.md`)),
  ];

  const artifacts: RemovedArtifact[] = [];
  for (const candidate of artifactCandidatesOfFeature) {
    if (reader.at('HEAD', candidate.path) !== null) continue;
    artifacts.push({
      feature: id,
      path: candidate.path,
      introducedBy: candidate.introducedBy,
      removedBy: candidate.removedBy,
      message: `旧实现被移除：V1 引入的 ${candidate.path} 已被后续版本删除，净差（base..HEAD）中不可见。`,
    });
  }

  return {
    id,
    name: nameAfter,
    origin: current === id ? 'branch' : 'files',
    status,
    files: sorted(new Set([...attributed, ...own.map((file) => file.path)])),
    changedPages: featurePages(attributed, pageIndex),
    capabilityCount: scenariosAfter.length,
    capabilitiesVsBase: baseCapabilities,
    revision: {
      from,
      fromKind,
      to: 'WORKTREE',
      revisionCount: featureRevisions.length,
      nameBefore,
      nameAfter,
      capabilities: revisionCapabilities,
      replacements,
      removedArtifacts: artifacts,
    },
  };
}

/** 某个 Feature 归属到的变更文件对应的 page ID（只登记真实解析出的 page，避免幻影页）。 */
function featurePages(paths: string[], pageIndex: PageIndex): string[] {
  const pages = new Set<string>();
  for (const path of paths) {
    const resolved = pageOfPath(path, pageIndex);
    if (resolved?.pageId) pages.add(resolved.pageId);
  }
  return sorted(pages);
}

function buildChangedPages(files: ChangedFile[], productName: string, pageIndex: PageIndex, attribution: Map<string, string[]>, undefinedRules: DiffFinding[]): ChangedPage[] {
  const grouped = new Map<string, ChangedPage>();
  for (const file of files) {
    const resolved = pageOfPath(file.path, pageIndex);
    if (!resolved) continue;
    const key = resolved.pageId ?? resolved.mapping;
    const existing = grouped.get(key) ?? {
      product: productName,
      pageId: resolved.pageId,
      name: resolved.pageId ? pageIndex.names.get(resolved.pageId) ?? null : null,
      route: resolved.pageId ? pageIndex.routes.get(resolved.pageId) ?? null : null,
      mapping: resolved.mapping,
      known: Boolean(resolved.pageId && (pageIndex.names.has(resolved.pageId) || pageIndex.routes.has(resolved.pageId))),
      files: [],
      features: [],
    };
    existing.files.push(file.path);
    existing.features = sorted(new Set([...existing.features, ...(attribution.get(file.path) ?? [])]));
    if (resolved.mapping === 'unmapped') existing.mapping = 'unmapped';
    grouped.set(key, existing);
  }
  const pages = [...grouped.values()].sort((a, b) => compareText(a.pageId ?? a.files[0] ?? '', b.pageId ?? b.files[0] ?? ''));
  for (const page of pages) {
    if (page.mapping !== 'unmapped') continue;
    undefinedRules.push({
      code: 'U002',
      title: '页面 ID 映射规则未定义',
      detail: `变更文件无法映射到 page ID：请在 product/pages.yaml（P0-3 Page Registry）登记该文件，或在 product/navigation.yaml 中显式声明页面。涉及文件：${page.files.join('、')}`,
      file: page.files[0],
    });
  }
  return pages;
}

function buildNavigationDiff(files: ChangedFile[], reader: BlobReader): NavigationDiff {
  const beforeMap = new Map(parseNavigationEntries(reader.base('product/navigation.yaml')).map((entry) => [entry.page, `${entry.module ?? '-'} / ${entry.name}`]));
  const afterMap = new Map(parseNavigationEntries(reader.latest('product/navigation.yaml')).map((entry) => [entry.page, `${entry.module ?? '-'} / ${entry.name}`]));
  const modified: NavigationDiff['modified'] = [];
  for (const page of sorted(afterMap.keys())) {
    const beforeValue = beforeMap.get(page);
    const afterValue = afterMap.get(page);
    if (beforeValue === undefined || afterValue === undefined || beforeValue === afterValue) continue;
    modified.push({ page, before: beforeValue, after: afterValue });
  }
  const fileChanged = files.some((file) => file.path === 'product/navigation.yaml');
  return {
    changed: fileChanged || modified.length > 0 || [...afterMap.keys()].some((page) => !beforeMap.has(page)) || [...beforeMap.keys()].some((page) => !afterMap.has(page)),
    added: sorted([...afterMap.keys()].filter((page) => !beforeMap.has(page))),
    removed: sorted([...beforeMap.keys()].filter((page) => !afterMap.has(page))),
    modified,
  };
}

function buildRouteDiff(files: ChangedFile[], reader: BlobReader): RouteDiff {
  const before = parseRoutes(reader.base('product/routes.yaml'));
  const after = parseRoutes(reader.latest('product/routes.yaml'));
  const modified: RouteDiff['modified'] = [];
  for (const id of sorted(after.keys())) {
    const beforeValue = before.get(id);
    const afterValue = after.get(id);
    if (beforeValue === undefined || afterValue === undefined || beforeValue === afterValue) continue;
    modified.push({ id, before: beforeValue, after: afterValue });
  }
  const fileChanged = files.some((file) => file.path === 'product/routes.yaml');
  return {
    changed: fileChanged || modified.length > 0 || [...after.keys()].some((id) => !before.has(id)) || [...before.keys()].some((id) => !after.has(id)),
    added: sorted([...after.keys()].filter((id) => !before.has(id))),
    removed: sorted([...before.keys()].filter((id) => !after.has(id))),
    modified,
  };
}

function buildSharedComponentDiff(root: string, files: ChangedFile[], sharedFiles: ChangedFile[], reader: BlobReader): SharedComponentDiff {
  const componentRegistry = loadComponentRegistry(root);
  const before = parseRegistry(reader.base('components/registry.yaml'));
  // P0-3 Component Registry 存在时优先使用其能力键解析；缺失时回退为直接解析 YAML。
  const after = componentRegistry.present
    ? new Map([...componentRegistry.entries].map(([id, entry]) => [id, entry.capabilityKey]))
    : parseRegistry(reader.latest('components/registry.yaml'));
  const modified = sorted([...after.keys()].filter((id) => before.has(id) && before.get(id) !== after.get(id)));
  const capabilityKeys: CapabilityKeyDiff = { changed: false, added: [], removed: [], modified: [], duplicates: [] };
  for (const id of sorted(after.keys())) {
    const afterKey = after.get(id) ?? null;
    const beforeKey = before.get(id) ?? null;
    if (afterKey && !beforeKey) capabilityKeys.added.push({ component: id, capabilityKey: afterKey });
    else if (afterKey && beforeKey && afterKey !== beforeKey) capabilityKeys.modified.push({ component: id, before: beforeKey, after: afterKey });
  }
  for (const id of sorted(before.keys())) {
    const beforeKey = before.get(id) ?? null;
    if (!beforeKey) continue;
    if (!after.has(id)) capabilityKeys.removed.push({ component: id, capabilityKey: beforeKey });
    else if (!(after.get(id) ?? null)) capabilityKeys.modified.push({ component: id, before: beforeKey, after: null });
  }
  const keyOwners = new Map<string, string[]>();
  for (const id of sorted(after.keys())) {
    const key = after.get(id) ?? null;
    if (!key) continue;
    keyOwners.set(key, [...(keyOwners.get(key) ?? []), id]);
  }
  capabilityKeys.duplicates = componentRegistry.present
    ? sorted(duplicateCapabilityKeys(componentRegistry).map((item) => `${item.capabilityKey}: ${[...item.owners].sort(compareText).join(', ')}`))
    : sorted([...keyOwners.entries()].filter(([, owners]) => owners.length > 1).map(([key, owners]) => `${key}: ${owners.join(', ')}`));
  capabilityKeys.changed = capabilityKeys.added.length > 0 || capabilityKeys.removed.length > 0 || capabilityKeys.modified.length > 0;
  const fileChanged = files.some((file) => file.path === 'components/registry.yaml');
  return {
    changed: fileChanged || sharedFiles.length > 0 || capabilityKeys.changed || [...after.keys()].some((id) => !before.has(id)) || [...before.keys()].some((id) => !after.has(id)),
    added: sorted([...after.keys()].filter((id) => !before.has(id))),
    removed: sorted([...before.keys()].filter((id) => !after.has(id))),
    modified,
    capabilityKeys,
  };
}

/** Scope 判定：与 proto lint 的 Feature scope 检查同源（同一个 authorizePath、同样的 L001/L006 编码，并同样传入 P0-3 Page Registry）。 */
function evaluateScope(root: string, files: ChangedFile[], current: string | null, pages: PageRegistry): ScopeEvaluation {
  const scopeViolations: ScopeEvaluation['scopeViolations'] = [];
  let error: string | null = null;
  if (current) {
    try {
      const scope = loadScope(root, current);
      if (scope) {
        for (const file of files) {
          if (authorizePath(file.path, scope, pages).allowed) continue;
          if (isProductPath(file.path)) {
            scopeViolations.push({ code: 'L006', file: file.path, message: `当前 Feature 未授权修改 Product Model：${file.path}` });
          } else {
            scopeViolations.push({ code: 'L001', file: file.path, message: `当前 Feature Scope 未授权修改：${file.path}` });
          }
        }
      }
    } catch (caught) {
      error = caught instanceof Error ? caught.message : String(caught);
    }
  }
  return {
    status: error === null && scopeViolations.length === 0 ? 'PASS' : 'BLOCKED',
    feature: current,
    checkedFiles: files.length,
    scopeViolations,
    error,
  };
}

interface FindingContext {
  files: ChangedFile[];
  features: FeatureImpact[];
  changedPages: ChangedPage[];
  sharedComponentDiff: SharedComponentDiff;
  scope: ScopeEvaluation;
  navigation: NavigationDiff;
  routes: RouteDiff;
  undefinedRules: DiffFinding[];
  risks: DiffFinding[];
}

function collectFindings(context: FindingContext): void {
  const { files, features, changedPages, sharedComponentDiff, scope, navigation, routes, undefinedRules, risks } = context;

  if (files.length === 0) {
    risks.push({ code: 'R010', title: '无变更', detail: '当前分支相对 base 没有任何文件变化。' });
  }
  if (features.length === 0 && files.length > 0) {
    undefinedRules.push({ code: 'U001', title: 'Feature 未定义', detail: '变更不属于任何 features/<id>/ 目录，无法确定本轮 Feature 的产品影响。' });
  }
  const branchDerived = features.filter((feature) => feature.origin === 'files').map((feature) => feature.id);
  if (branchDerived.length > 0) {
    undefinedRules.push({ code: 'U008', title: 'Feature ID 无法由 Branch 推导', detail: `当前 Branch 不是 feature/*，以下 Feature 由 features/** 的增删变化推导：${branchDerived.join('、')}。` });
  }
  for (const feature of features) {
    if (feature.capabilityCount === 0) {
      undefinedRules.push({ code: 'U003', title: '用户能力清单未定义', detail: `Feature ${feature.id} 没有可解析的能力清单（features/${feature.id}/scenarios.yaml 缺失、为空或结构无法识别，例如顶层缺少 scenarios: 列表）。`, file: `features/${feature.id}/scenarios.yaml` });
    }
    if (feature.revision.replacements.length > 0 || feature.revision.removedArtifacts.length > 0) {
      risks.push({
        code: 'R001',
        title: '需求反悔：旧交互被移除/替换',
        detail: `Feature ${feature.id} 在 ${feature.revision.from.slice(0, 7)} 之后发生了需求替换：替换条目 ${feature.revision.replacements.length} 条，被移除实现 ${feature.revision.removedArtifacts.length} 个。请 PM 确认旧交互已被有意移除。`,
      });
    }
    for (const artifact of feature.revision.removedArtifacts) {
      risks.push({ code: 'R002', title: '实现文件被移除且未替代', detail: artifact.message, file: artifact.path });
    }
  }
  if (features.length > 1) {
    risks.push({
      code: 'R008',
      title: '本分支同时存在多个 Feature',
      detail: `检测到 ${features.length} 个 Feature（${features.map((feature) => feature.id).join('、')}）；合并态必须分别确认每个 Feature 的产品影响。`,
    });
  }
  for (const page of changedPages) {
    if (page.features.length <= 1) continue;
    risks.push({
      code: 'R003',
      title: '同一页面被多个 Feature 修改',
      detail: `页面 ${page.pageId ?? page.files[0]} 的变更来自多个 Feature（${page.features.join('、')}），存在 UI 入口与产品语义冲突风险。`,
      file: page.files[0],
    });
  }
  if (sharedComponentDiff.capabilityKeys.duplicates.length > 0) {
    risks.push({ code: 'R004', title: 'capability_key 重复', detail: `同一能力键被多个公共组件声明：${sharedComponentDiff.capabilityKeys.duplicates.join('；')}`, file: 'components/registry.yaml' });
  }
  if (sharedComponentDiff.capabilityKeys.changed) {
    risks.push({ code: 'R011', title: '公共组件能力键变化', detail: 'capability_key 变化会影响既有页面的能力去重判定与 Studio 展示。', file: 'components/registry.yaml' });
  }
  if (sharedComponentDiff.added.length > 0) {
    risks.push({ code: 'R007', title: '新增公共组件', detail: `新增公共组件：${sharedComponentDiff.added.join('、')}；需确认已登记 components/registry.yaml 并完成能力去重。`, file: 'components/registry.yaml' });
  }
  if (scope.scopeViolations.length > 0) {
    undefinedRules.push({
      code: 'U006',
      title: 'Scope 授权规则未覆盖变更文件',
      detail: `以下变更没有匹配的 Scope 规则：${scope.scopeViolations.map((issue) => `${issue.code} ${issue.file}`).join('；')}`,
    });
  }
  if (scope.status === 'BLOCKED') {
    risks.push({
      code: 'R009',
      title: 'Scope BLOCKED',
      detail: scope.error ? `Scope 无法判定：${scope.error}` : `确定性 Scope 检查未通过：${scope.scopeViolations.map((issue) => issue.code).join('、')}`,
    });
  }
  if (files.some((file) => file.path.startsWith('product/'))) {
    risks.push({ code: 'R005', title: 'Product Model 变化', detail: `变更涉及 Product Model：${files.filter((file) => file.path.startsWith('product/')).map((file) => file.path).join('、')}。` });
  }
  if (navigation.changed !== routes.changed) {
    risks.push({
      code: 'R006',
      title: 'Navigation 与 Routes 变化不同步',
      detail: `Navigation changed=${navigation.changed}，Routes changed=${routes.changed}；导航入口与路由必须同步。`,
    });
  }
}

// ---------------------------------------------------------------------------
// 文本输出：既有 5 个文件分组段落逐字保持不变，新增段落面向 PM 可读性
// ---------------------------------------------------------------------------

function counts(added: number, modified: number, removed: number): string {
  return `+${added} 新增 ~${modified} 修改 -${removed} 删除`;
}

/** 计数含义：说明两个比较口径不同，避免 PM 误以为两组数字应当相等。 */
const COUNT_LEGEND = '计数含义：+a ~b -c = 用户能力的新增 / 修改 / 删除数量；「vs base」相对基线统计，行尾「V1 → latest」相对首次修订统计，两者口径不同，数字不必相等。';

/** 拿不到基线分支名时的兜底说法：如实说明它来自哪里（proto.config.yaml → workspace.base_branch），不编造分支名。 */
const BASE_LEGEND_FALLBACK = '工作区配置的基线分支（proto.config.yaml → workspace.base_branch）';

function baseLegend(baseBranch: string | null): string {
  const label = baseBranch ? `工作区配置的基线分支 ${baseBranch}` : BASE_LEGEND_FALLBACK;
  return `比较口径：base = 「${label}」的 merge-base 状态；V1(短哈希) = 该 Feature 的首次修订提交；latest = 当前工作区修订。`;
}

/** Product Model 的一行汇总：让 PM 一眼区分「模型未变」与「页面 spec 已变」。 */
const PRODUCT_MODEL_PARTS: Array<[string, string]> = [
  ['product.yaml', 'product.yaml'], ['navigation.yaml', 'navigation'], ['routes.yaml', 'routes'],
  ['terminology.yaml', 'terminology'], ['permissions.yaml', 'permissions'],
];

function productModelSummary(diff: ProductDiff): string {
  const changed = new Set(diff.productModel.map((file) => file.path));
  const changedLabels: string[] = [];
  const unchangedLabels: string[] = [];
  for (const [path, label] of PRODUCT_MODEL_PARTS) {
    if (changed.has(`product/${path}`)) changedLabels.push(label);
    else unchangedLabels.push(label);
  }
  for (const file of diff.productModel) {
    const name = file.path.replace(/^product\//, '');
    if (!PRODUCT_MODEL_PARTS.some(([path]) => path === name)) changedLabels.push(`${name}（${file.status}）`);
  }
  if (changedLabels.length === 0) return `PRODUCT MODEL: unchanged（${unchangedLabels.join('、')} 均未变化）`;
  return `PRODUCT MODEL: changed（${changedLabels.join('、')}）；未变化：${unchangedLabels.length > 0 ? unchangedLabels.join('、') : 'None'}`;
}

function formatCapabilities(diff: ProductDiff): string[] {
  if (diff.features.length === 0) return ['- None'];
  const lines: string[] = [];
  for (const feature of diff.features) {
    const change = feature.capabilitiesVsBase;
    lines.push(`- ${feature.id} ${feature.name}（能力共 ${feature.capabilityCount} 条；${counts(change.added.length, change.modified.length, change.removed.length)}）`);
    for (const item of change.added) lines.push(`  + 新增 ${item.id}：${item.then}`);
    for (const item of change.modified) lines.push(`  ~ 修改 ${item.id}：${item.before.then} → ${item.after.then}`);
    for (const item of change.removed) lines.push(`  - 删除 ${item.id}：${item.then}`);
  }
  return lines;
}

export function formatDiff(diff: ProductDiff, baseBranch?: string): string {
  const groups: Array<[string, ChangedFile[]]> = [
    ['Product Model', diff.productModel], ['Pages', diff.pages], ['Shared Components', diff.sharedComponents],
    ['Feature Files', diff.featureFiles], ['Prototype Files', diff.prototypeFiles],
  ];
  const lines = [`Changed Files: ${diff.changedFiles.length}`, ''];
  for (const [name, files] of groups) {
    lines.push(`${name}: ${files.length}`);
    for (const file of files) lines.push(`- ${file.status} ${file.path}`);
    lines.push('');
  }

  // 分类一致性只在异常时占用行数：正常情况由上方 5 个分组计数相加等于 Changed Files 自证。
  if (diff.otherFiles.length > 0) {
    lines.push(`Other Files: ${diff.otherFiles.length}`);
    for (const file of diff.otherFiles) lines.push(`- ${file.status} ${file.path}`);
    lines.push('');
  }
  if (diff.classification.overlaps.length > 0) {
    lines.push(`Multi-Category Files (counted once): ${diff.classification.overlaps.length}`);
    for (const path of diff.classification.overlaps) lines.push(`- ${path} → ${diff.classification.assigned[path] ?? 'otherFiles'}`);
    lines.push('');
  }
  if (diff.classification.uncategorized.length > 0) {
    lines.push(`Uncategorized: ${diff.classification.uncategorized.join(', ')}`);
    lines.push('');
  }

  lines.push('PRODUCT', `${diff.product.name || '(未定义)'} (${diff.product.id || '-'}) v${diff.product.version || '-'}`, '');

  lines.push('CHANGED PAGES (产品名 / page ID)');
  if (diff.changedPages.length === 0) lines.push('- None');
  for (const page of diff.changedPages) {
    const label = `${page.product || '(未定义)'} / ${page.pageId ?? '(unmapped)'}${page.name ? `（${page.name}）` : ''}`;
    const featureLabel = page.features.length > 0 ? ` features=${page.features.join('、')}` : '';
    lines.push(`- ${label} route=${page.route ?? '-'} mapping=${page.mapping}${featureLabel}`);
    for (const file of page.files) lines.push(`  - ${file}`);
  }
  lines.push('');

  lines.push('PRODUCT MODEL');
  lines.push(productModelSummary(diff));
  const specFiles = diff.changedFiles.filter((file) => file.path.startsWith('specs/')).map((file) => file.path);
  if (specFiles.length > 0) lines.push(`说明：${specFiles.join('、')} 属于页面级 spec（已计入 Pages 分组），不属于 Product Model。`);
  lines.push([
    `NAVIGATION: ${diff.navigation.changed ? 'changed' : 'unchanged'}`,
    `ROUTES: ${diff.routes.changed ? 'changed' : 'unchanged'}`,
    `SHARED COMPONENTS: ${diff.sharedComponentDiff.changed ? 'changed' : 'unchanged'}`,
    `CAPABILITY KEY: ${diff.sharedComponentDiff.capabilityKeys.changed ? 'changed' : 'unchanged'}`,
  ].join(' | '));
  for (const page of diff.navigation.added) lines.push(`+ navigation ${page}`);
  for (const page of diff.navigation.removed) lines.push(`- navigation ${page}`);
  for (const item of diff.navigation.modified) lines.push(`~ navigation ${item.page}: ${item.before} → ${item.after}`);
  for (const id of diff.routes.added) lines.push(`+ route ${id}`);
  for (const id of diff.routes.removed) lines.push(`- route ${id}`);
  for (const item of diff.routes.modified) lines.push(`~ route ${item.id}: ${item.before} → ${item.after}`);
  for (const id of diff.sharedComponentDiff.added) lines.push(`+ shared component ${id}`);
  for (const id of diff.sharedComponentDiff.removed) lines.push(`- shared component ${id}`);
  for (const id of diff.sharedComponentDiff.modified) lines.push(`~ shared component ${id}`);
  for (const item of diff.sharedComponentDiff.capabilityKeys.added) lines.push(`+ capability_key ${item.component}: ${item.capabilityKey}`);
  for (const item of diff.sharedComponentDiff.capabilityKeys.removed) lines.push(`- capability_key ${item.component}: ${item.capabilityKey}`);
  for (const item of diff.sharedComponentDiff.capabilityKeys.modified) lines.push(`~ capability_key ${item.component}: ${item.before ?? '-'} → ${item.after ?? '-'}`);
  for (const item of diff.sharedComponentDiff.capabilityKeys.duplicates) lines.push(`! duplicate ${item}`);
  lines.push(`SCOPE: ${diff.scope.status}（feature: ${diff.scope.feature ?? 'None'}，检查文件 ${diff.scope.checkedFiles}）`);
  for (const issue of diff.scope.scopeViolations) lines.push(`- ${issue.code} ${issue.file} ${issue.message}`);
  if (diff.scope.error) lines.push(`- ${diff.scope.error}`);
  lines.push('SCOPE 口径：仅判定 Scope 授权（L001 越界 / L006 Product Model 未授权）。结构性、术语、组件登记与 Schema 问题不在本命令判定范围内，请以 proto lint 为准。');
  lines.push('');

  lines.push(`FEATURES (vs base): ${diff.features.length}`);
  if (diff.features.length === 0) {
    lines.push('- None');
  } else {
    // 未显式传入基线分支时，退回 diff 自身携带的 base 口径（fromKind === 'base' 时 from 即基线分支名）。
    const knownBase = baseBranch ?? diff.features.find((feature) => feature.revision.fromKind === 'base')?.revision.from ?? null;
    lines.push(baseLegend(knownBase));
    lines.push(COUNT_LEGEND);
  }
  for (const feature of diff.features) {
    const revision = feature.revision;
    lines.push(`- [${feature.status}] ${feature.id} ${feature.name}（origin: ${feature.origin}；修订 ${revision.revisionCount} 次；文件 ${feature.files.length}；页面 ${feature.changedPages.length ? feature.changedPages.join('、') : 'None'}；能力 ${feature.capabilityCount} 条）`);
    lines.push(`  vs base：${counts(feature.capabilitiesVsBase.added.length, feature.capabilitiesVsBase.modified.length, feature.capabilitiesVsBase.removed.length)}`);
    lines.push(`  V1(${revision.from.slice(0, 7)}) → latest：${counts(revision.capabilities.added.length, revision.capabilities.modified.length, revision.capabilities.removed.length)}；需求替换 ${revision.replacements.length} 条；被移除实现 ${revision.removedArtifacts.length} 个`);
  }
  lines.push('');

  lines.push('CAPABILITIES (vs base：基线分支 → 当前工作区修订)');
  lines.push(...formatCapabilities(diff));
  lines.push('');

  const replacements = diff.requirementReplacements;
  lines.push(`REQUIREMENT REPLACEMENTS (V1 → latest): ${replacements.length === 0 ? 'None（未检测到旧交互被移除/替换）' : `${replacements.length} 条`}`);
  if (replacements.length > 0) {
    lines.push('口径：[removed] = V1 有、最新版本已不存在（旧交互被移除）；[replaced] = 两版都有但内容不同（旧交互被移除/替换）；下面逐条给出旧/新原文，不再重复整句说明。');
  }
  for (const item of replacements) {
    const tag = item.kind === 'removed' ? '旧交互被移除' : '旧交互被移除/替换';
    lines.push(`- [${item.kind}] ${item.feature} ${item.source.replace(`features/${item.feature}/`, '')}#${item.subject} —— ${tag}`);
    if (item.before) lines.push(`  旧: ${item.before}`);
    if (item.after) lines.push(`  新: ${item.after}`);
  }
  if (diff.removedArtifacts.length > 0) {
    lines.push('');
    lines.push(`REMOVED ARTIFACTS (V1 → latest): ${diff.removedArtifacts.length}`);
    for (const item of diff.removedArtifacts) {
      lines.push(`- ${item.path}（${item.introducedBy} 引入 → ${item.removedBy} 删除）旧交互被移除，净差（base..HEAD）中不可见。`);
    }
  }
  lines.push('');

  if (diff.undefinedRules.length > 0) {
    lines.push(`UNDEFINED RULES: ${diff.undefinedRules.length}`);
    for (const item of diff.undefinedRules) lines.push(`- ${item.code} ${item.title}${item.file ? ` (${item.file})` : ''}: ${item.detail}`);
    lines.push('');
  }
  if (diff.risks.length > 0) {
    lines.push(`RISKS: ${diff.risks.length}`);
    for (const item of diff.risks) lines.push(`- ${item.code} ${item.title}: ${item.detail}`);
  } else {
    lines.push('RISKS: None');
  }

  return lines.join('\n').trimEnd();
}

export function buildSemanticPrompt(root: string): string {
  const config = loadConfig(root);
  const scope = loadScope(root);
  const feature = scope?.feature.id ?? 'None';
  const requirementPath = scope ? join(root, 'features', feature, 'requirement.md') : null;
  const requirement = requirementPath ? readFileSync(requirementPath, 'utf8') : '无当前 Feature。';
  return `你是 Product Owner Review 助手。仅根据输入生成中文 Product Diff，不判断是否允许 Merge。\n\n## 输出结构\n# Product Diff\n## 页面\n## 交互\n## 产品规则\n## Product Model\n## Shared Component\n## 风险\n\n## Product\n${JSON.stringify(loadProduct(root), null, 2)}\n\n## Feature\n${feature}\n\n## Requirement\n${requirement}\n\n## Scope\n${JSON.stringify(scope, null, 2)}\n\n## Deterministic Diff\n${formatDiff(createDiff(root), config.workspace.base_branch)}\n\n## Git Diff\n${fullDiff(root, config.workspace.base_branch) || '(无已跟踪文件差异；请结合文件列表判断未跟踪文件。)'}`;
}
