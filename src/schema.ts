import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import YAML from 'yaml';
import { normalizePath } from './io.js';
import type { LintIssue } from './types.js';

/**
 * Product Model / Scope Schema 校验（P0-1）。
 *
 * 设计原则：
 * - 结构、必填项、未知字段、重复 ID、非法引用分别使用稳定 code（L007/L008/L009），
 *   与既有 L001–L006 语义兼容，不改变旧 code 含义；
 * - 每条错误都带精确文件、字段路径（field）与可执行修复建议（fix）；
 * - V0.1 工作区仍然可以通过：`schema_version` 字段是可选增强，缺失即视为版本 1。
 */

export const SCHEMA_VERSION = 1;

/** 各产物对应的 JSON Schema 文件，供文档与编辑器提示使用（运行时校验以本模块为准）。 */
export const SCHEMA_FILES = {
  product: 'schemas/product.schema.json',
  navigation: 'schemas/navigation.schema.json',
  routes: 'schemas/routes.schema.json',
  terminology: 'schemas/terminology.schema.json',
  componentRegistry: 'schemas/component-registry.schema.json',
  featureScope: 'schemas/scope.schema.json',
} as const;

type Kind = 'string' | 'number' | 'boolean' | 'array' | 'object';

interface LoadedDocument {
  data: unknown;
  duplicateKeyMessages: string[];
  missing: boolean;
}

function loadDocument(root: string, relative: string): LoadedDocument {
  const path = join(root, relative);
  if (!existsSync(path)) return { data: null, duplicateKeyMessages: [], missing: true };
  const document = YAML.parseDocument(readFileSync(path, 'utf8'), { uniqueKeys: true });
  let data: unknown = null;
  try {
    data = document.toJS();
  } catch {
    data = null;
  }
  return { data, duplicateKeyMessages: document.errors.map((error) => error.message), missing: false };
}

function kindOf(value: unknown): Kind | 'null' | 'undefined' {
  if (value === null) return 'null';
  if (value === undefined) return 'undefined';
  if (Array.isArray(value)) return 'array';
  return typeof value as Kind;
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

interface IssueContext {
  file: string;
  issues: LintIssue[];
}

function schemaIssue(context: IssueContext, field: string, message: string, fix: string): void {
  context.issues.push({ code: 'L007', title: 'Schema Violation', message, file: context.file, field, fix });
}

function duplicateIssue(context: IssueContext, field: string, message: string, fix: string): void {
  context.issues.push({ code: 'L008', title: 'Duplicate ID', message, file: context.file, field, fix });
}

function referenceIssue(context: IssueContext, field: string, message: string, fix: string): void {
  context.issues.push({ code: 'L009', title: 'Invalid Reference', message, file: context.file, field, fix });
}

/** 未知字段：P0-1 要求能 BLOCK，因此逐字段给出可执行修复建议。 */
function rejectUnknownKeys(context: IssueContext, value: Record<string, unknown>, allowed: string[], field: string): void {
  for (const key of Object.keys(value)) {
    if (allowed.includes(key)) continue;
    // field 是已经以 "." 结尾（或为空）的路径前缀
    const path = `${field}${key}`;
    schemaIssue(context, path, `未知字段 ${path}。允许的字段：${allowed.join('、')}。`, `删除字段 ${path}，或确认拼写后更新对应的 schemas/*.schema.json。`);
  }
}

/** 版本字段：可选；出现时必须是受支持的整数版本。 */
function checkSchemaVersion(context: IssueContext, value: Record<string, unknown>): void {
  if (!('schema_version' in value)) return;
  const version = value.schema_version;
  if (typeof version !== 'number' || !Number.isInteger(version)) {
    schemaIssue(context, 'schema_version', `schema_version 必须是整数，当前为 ${JSON.stringify(version)}。`, `将 schema_version 改为 ${SCHEMA_VERSION}，或删除该字段（缺省视为 ${SCHEMA_VERSION}）。`);
    return;
  }
  if (version !== SCHEMA_VERSION) {
    schemaIssue(context, 'schema_version', `不支持的 schema_version：${version}（当前仅支持 ${SCHEMA_VERSION}）。`, `将 schema_version 改为 ${SCHEMA_VERSION}，或升级 CLI 版本以支持该 schema。`);
  }
}

function requireString(context: IssueContext, value: Record<string, unknown>, key: string, field: string): boolean {
  if (!(key in value)) {
    schemaIssue(context, `${field}${key}`, `缺少必填字段 ${field}${key}。`, `在 ${context.file} 中补充 ${field}${key}。`);
    return false;
  }
  if (typeof value[key] !== 'string' || (value[key] as string).trim() === '') {
    schemaIssue(context, `${field}${key}`, `字段 ${field}${key} 必须是非空字符串，当前类型 ${kindOf(value[key])}。`, `将 ${field}${key} 改为非空字符串。`);
    return false;
  }
  return true;
}

function requireObject(context: IssueContext, value: Record<string, unknown>, key: string, field: string): Record<string, unknown> | null {
  if (!(key in value)) {
    schemaIssue(context, `${field}${key}`, `缺少必填字段 ${field}${key}。`, `在 ${context.file} 中补充 ${field}${key}。`);
    return null;
  }
  if (!isPlainObject(value[key])) {
    schemaIssue(context, `${field}${key}`, `字段 ${field}${key} 必须是对象，当前类型 ${kindOf(value[key])}。`, `将 ${field}${key} 改为对象。`);
    return null;
  }
  return value[key] as Record<string, unknown>;
}

function requireArray(context: IssueContext, value: Record<string, unknown>, key: string, field: string): unknown[] | null {
  if (!(key in value)) {
    schemaIssue(context, `${field}${key}`, `缺少必填字段 ${field}${key}。`, `在 ${context.file} 中补充 ${field}${key}。`);
    return null;
  }
  if (!Array.isArray(value[key])) {
    schemaIssue(context, `${field}${key}`, `字段 ${field}${key} 必须是数组，当前类型 ${kindOf(value[key])}。`, `将 ${field}${key} 改为数组。`);
    return null;
  }
  return value[key] as unknown[];
}

function reportDuplicateKeys(context: IssueContext, messages: string[]): void {
  for (const message of messages) {
    duplicateIssue(context, '', message, '删除重复的键，或将其合并为一条后重试。');
  }
}

function stringArray(context: IssueContext, value: Record<string, unknown>, key: string, field: string): string[] {
  const array = requireArray(context, value, key, field);
  if (!array) return [];
  const result: string[] = [];
  array.forEach((item, index) => {
    if (typeof item !== 'string' || item.trim() === '') {
      schemaIssue(context, `${field}${key}[${index}]`, `数组项必须是字符串，当前类型 ${kindOf(item)}。`, `将 ${field}${key}[${index}] 改为字符串。`);
      return;
    }
    result.push(item);
  });
  return result;
}

// ---------------------------------------------------------------------------
// product/product.yaml
// ---------------------------------------------------------------------------

export interface ProductSchemaResult {
  moduleIds: Set<string>;
  issues: LintIssue[];
}

export function checkProductSchema(root: string): ProductSchemaResult {
  const file = 'product/product.yaml';
  const context: IssueContext = { file, issues: [] };
  const loaded = loadDocument(root, file);
  if (loaded.missing) {
    schemaIssue(context, '', `缺少产品模型文件 ${file}。`, '运行 proto init 生成模板，或手工创建 product/product.yaml。');
    return { moduleIds: new Set(), issues: context.issues };
  }
  reportDuplicateKeys(context, loaded.duplicateKeyMessages);
  if (!isPlainObject(loaded.data)) {
    schemaIssue(context, '', `${file} 的根节点必须是对象。`, '按 schemas/product.schema.json 组织 product 与 modules。');
    return { moduleIds: new Set(), issues: context.issues };
  }
  const document = loaded.data;
  rejectUnknownKeys(context, document, ['product', 'modules', 'schema_version'], '');
  checkSchemaVersion(context, document);
  const product = requireObject(context, document, 'product', '');
  if (product) {
    rejectUnknownKeys(context, product, ['id', 'name', 'version', 'description'], 'product.');
    requireString(context, product, 'id', 'product.');
    requireString(context, product, 'name', 'product.');
    requireString(context, product, 'version', 'product.');
  }
  const modules = requireArray(context, document, 'modules', '');
  const moduleIds = new Set<string>();
  if (modules) {
    modules.forEach((item, index) => {
      if (!isPlainObject(item)) {
        schemaIssue(context, `modules[${index}]`, `modules[${index}] 必须是对象，当前类型 ${kindOf(item)}。`, '为每个模块提供 id 与 name。');
        return;
      }
      rejectUnknownKeys(context, item, ['id', 'name', 'description'], `modules[${index}].`);
      if (requireString(context, item, 'id', `modules[${index}].`)) {
        const id = item.id as string;
        if (moduleIds.has(id)) {
          duplicateIssue(context, `modules[${index}].id`, `模块 id 重复：${id}。`, `合并重复模块，或为其中之一使用新的 id。`);
        }
        moduleIds.add(id);
      }
      requireString(context, item, 'name', `modules[${index}].`);
    });
  }
  return { moduleIds, issues: context.issues };
}

// ---------------------------------------------------------------------------
// product/navigation.yaml
// ---------------------------------------------------------------------------

export interface NavigationSchemaResult {
  pages: Set<string>;
  moduleRefs: Array<{ field: string; module: string }>;
  issues: LintIssue[];
}

export function checkNavigationSchema(root: string): NavigationSchemaResult {
  const file = 'product/navigation.yaml';
  const context: IssueContext = { file, issues: [] };
  const loaded = loadDocument(root, file);
  const pages = new Set<string>();
  const moduleRefs: Array<{ field: string; module: string }> = [];
  if (loaded.missing) {
    schemaIssue(context, '', `缺少导航文件 ${file}。`, '运行 proto init 生成模板，或手工创建 product/navigation.yaml。');
    return { pages, moduleRefs, issues: context.issues };
  }
  reportDuplicateKeys(context, loaded.duplicateKeyMessages);
  if (!isPlainObject(loaded.data)) {
    schemaIssue(context, '', `${file} 的根节点必须是对象。`, '使用 navigation 数组组织导航项。');
    return { pages, moduleRefs, issues: context.issues };
  }
  const document = loaded.data;
  rejectUnknownKeys(context, document, ['navigation', 'schema_version'], '');
  checkSchemaVersion(context, document);
  const items = requireArray(context, document, 'navigation', '');
  if (!items) return { pages, moduleRefs, issues: context.issues };

  const walk = (list: unknown[], field: string): void => {
    list.forEach((item, index) => {
      const itemField = `${field}[${index}].`;
      if (!isPlainObject(item)) {
        schemaIssue(context, `${field}[${index}]`, `导航项必须是对象，当前类型 ${kindOf(item)}。`, '为每个导航项提供 name，叶子节点提供 page。');
        return;
      }
      rejectUnknownKeys(context, item, ['id', 'module', 'page', 'name', 'children'], itemField);
      requireString(context, item, 'name', itemField);
      if ('id' in item && (typeof item.id !== 'string' || (item.id as string).trim() === '')) {
        schemaIssue(context, `${itemField}id`, `字段 ${itemField}id 必须是非空字符串。`, `将 ${itemField}id 改为非空字符串，或删除该字段。`);
      }
      if ('module' in item) {
        if (typeof item.module !== 'string' || (item.module as string).trim() === '') {
          schemaIssue(context, `${itemField}module`, `字段 ${itemField}module 必须是非空字符串。`, `将 ${itemField}module 改为已定义模块的 id。`);
        } else {
          moduleRefs.push({ field: `${itemField}module`, module: item.module as string });
        }
      }
      if ('page' in item) {
        if (typeof item.page !== 'string' || (item.page as string).trim() === '') {
          schemaIssue(context, `${itemField}page`, `字段 ${itemField}page 必须是非空字符串。`, `将 ${itemField}page 改为 product/routes.yaml 中已定义的 route id。`);
        } else if (!pages.has(item.page as string)) {
          pages.add(item.page as string);
        } else {
          duplicateIssue(context, `${itemField}page`, `导航中重复引用了页面：${item.page as string}。`, '每个页面在导航中只应出现一次；如需多处入口，请使用 children 结构。');
        }
      }
      if ('children' in item) {
        if ('page' in item) {
          schemaIssue(context, `${itemField}children`, `导航项同时声明了 page 与 children：${itemField}。`, '把 page 移到 children 的叶子节点上，或删除 children。');
        }
        const children = item.children;
        if (!Array.isArray(children)) {
          schemaIssue(context, `${itemField}children`, `children 必须是数组，当前类型 ${kindOf(children)}。`, `将 ${itemField}children 改为数组。`);
        } else {
          walk(children as unknown[], `${itemField}children`.replace(/\.$/, ''));
        }
      }
      if (!('page' in item) && !('children' in item) && !('module' in item)) {
        schemaIssue(context, `${field}[${index}]`, `导航项既没有 page 也没有 children：${field}[${index}]。`, '为叶子节点补充 page，或为分组补充 children。');
      }
    });
  };
  walk(items, 'navigation');
  return { pages, moduleRefs, issues: context.issues };
}

// ---------------------------------------------------------------------------
// product/routes.yaml
// ---------------------------------------------------------------------------

export interface RoutesSchemaResult {
  routeIds: Set<string>;
  issues: LintIssue[];
}

export function checkRoutesSchema(root: string, moduleIds: Set<string>): RoutesSchemaResult {
  const file = 'product/routes.yaml';
  const context: IssueContext = { file, issues: [] };
  const loaded = loadDocument(root, file);
  const routeIds = new Set<string>();
  if (loaded.missing) {
    schemaIssue(context, '', `缺少路由文件 ${file}。`, '运行 proto init 生成模板，或手工创建 product/routes.yaml。');
    return { routeIds, issues: context.issues };
  }
  reportDuplicateKeys(context, loaded.duplicateKeyMessages);
  if (!isPlainObject(loaded.data)) {
    schemaIssue(context, '', `${file} 的根节点必须是对象。`, '使用 routes 映射组织路由。');
    return { routeIds, issues: context.issues };
  }
  const document = loaded.data;
  rejectUnknownKeys(context, document, ['routes', 'schema_version'], '');
  checkSchemaVersion(context, document);
  const routes = requireObject(context, document, 'routes', '');
  if (!routes) return { routeIds, issues: context.issues };
  for (const [id, value] of Object.entries(routes)) {
    const field = `routes.${id}`;
    if (!isPlainObject(value)) {
      schemaIssue(context, field, `${field} 必须是对象（含 path 字段），当前类型 ${kindOf(value)}。`, `将 ${field} 改为 { path: "/...", module: "<module id>" }。`);
      continue;
    }
    rejectUnknownKeys(context, value, ['path', 'module', 'name'], `${field}.`);
    if (requireString(context, value, 'path', `${field}.`) && !(value.path as string).startsWith('/')) {
      schemaIssue(context, `${field}.path`, `路由路径必须以 / 开头：${value.path as string}。`, `将 ${field}.path 改为以 / 开头的绝对路径。`);
    }
    routeIds.add(id);
    if ('module' in value) {
      if (typeof value.module !== 'string' || (value.module as string).trim() === '') {
        schemaIssue(context, `${field}.module`, `${field}.module 必须是非空字符串。`, `将其改为 product/product.yaml 中已定义的模块 id。`);
      } else if (moduleIds.size > 0 && !moduleIds.has(value.module as string)) {
        referenceIssue(context, `${field}.module`, `${field}.module 指向不存在的模块：${value.module as string}。`, `将其改为已定义模块 id（${[...moduleIds].join('、')}），或在 product/product.yaml 中补充该模块。`);
      }
    }
  }
  return { routeIds, issues: context.issues };
}

// ---------------------------------------------------------------------------
// product/terminology.yaml
// ---------------------------------------------------------------------------

export function checkTerminologySchema(root: string): LintIssue[] {
  const file = 'product/terminology.yaml';
  const context: IssueContext = { file, issues: [] };
  const loaded = loadDocument(root, file);
  if (loaded.missing) {
    schemaIssue(context, '', `缺少术语表 ${file}。`, '运行 proto init 生成模板，或手工创建 product/terminology.yaml。');
    return context.issues;
  }
  reportDuplicateKeys(context, loaded.duplicateKeyMessages);
  if (!isPlainObject(loaded.data)) {
    schemaIssue(context, '', `${file} 的根节点必须是对象。`, '使用 terms 映射组织术语。');
    return context.issues;
  }
  const document = loaded.data;
  rejectUnknownKeys(context, document, ['terms', 'schema_version'], '');
  checkSchemaVersion(context, document);
  const terms = requireObject(context, document, 'terms', '');
  if (!terms) return context.issues;
  for (const [key, value] of Object.entries(terms)) {
    const field = `terms.${key}`;
    if (!isPlainObject(value)) {
      schemaIssue(context, field, `${field} 必须是对象（至少包含 zh_CN），当前类型 ${kindOf(value)}。`, `将 ${field} 改为 { zh_CN: "中文术语" }。`);
      continue;
    }
    rejectUnknownKeys(context, value, ['zh_CN', 'en', 'definition'], `${field}.`);
    if (!('zh_CN' in value)) {
      schemaIssue(context, `${field}.zh_CN`, `术语缺少中文名称：${field}.zh_CN。`, `为 ${field} 补充 zh_CN 字段。`);
    } else if (typeof value.zh_CN !== 'string' || (value.zh_CN as string).trim() === '') {
      schemaIssue(context, `${field}.zh_CN`, `${field}.zh_CN 必须是非空字符串。`, `将 ${field}.zh_CN 改为中文术语名称。`);
    }
  }
  return context.issues;
}

// ---------------------------------------------------------------------------
// components/registry.yaml
// ---------------------------------------------------------------------------

export interface ComponentRegistrySchemaResult {
  componentIds: Set<string>;
  issues: LintIssue[];
}

export function checkComponentRegistrySchema(root: string): ComponentRegistrySchemaResult {
  const file = 'components/registry.yaml';
  const context: IssueContext = { file, issues: [] };
  const loaded = loadDocument(root, file);
  const componentIds = new Set<string>();
  if (loaded.missing) {
    schemaIssue(context, '', `缺少公共组件登记表 ${file}。`, '运行 proto init 生成模板，或手工创建 components/registry.yaml。');
    return { componentIds, issues: context.issues };
  }
  reportDuplicateKeys(context, loaded.duplicateKeyMessages);
  if (!isPlainObject(loaded.data)) {
    schemaIssue(context, '', `${file} 的根节点必须是对象。`, '使用 components 映射登记公共组件。');
    return { componentIds, issues: context.issues };
  }
  const document = loaded.data;
  rejectUnknownKeys(context, document, ['components', 'schema_version'], '');
  checkSchemaVersion(context, document);
  const components = requireObject(context, document, 'components', '');
  if (!components) return { componentIds, issues: context.issues };
  for (const [id, value] of Object.entries(components)) {
    const field = `components.${id}`;
    componentIds.add(id);
    if (!isPlainObject(value)) {
      schemaIssue(context, field, `${field} 必须是对象，当前类型 ${kindOf(value)}。`, `将 ${field} 改为 { description: "...", type: "shared" }。`);
      continue;
    }
    rejectUnknownKeys(context, value, ['description', 'purpose', 'type', 'capability_key', 'scope'], `${field}.`);
    if ('description' in value && typeof value.description !== 'string') {
      schemaIssue(context, `${field}.description`, `${field}.description 必须是字符串。`, `将 ${field}.description 改为字符串。`);
    }
    if ('capability_key' in value) {
      const capability = value.capability_key;
      if (typeof capability !== 'string' || !/^[a-z][a-z0-9]*(?:[._-][a-z0-9]+)*$/.test(capability)) {
        schemaIssue(context, `${field}.capability_key`, `capability_key 必须是以小写字母开头的稳定键（如 data-table），当前为 ${JSON.stringify(capability)}。`, `将 ${field}.capability_key 改为稳定的小写能力键。`);
      }
    }
  }
  return { componentIds, issues: context.issues };
}

// ---------------------------------------------------------------------------
// features/<id>/scope.yaml
// ---------------------------------------------------------------------------

export interface ScopeSchemaResult {
  issues: LintIssue[];
  /**
   * scope.yaml 中声明的 feature.id（仅供报告与测试使用）。
   * 注意：调用方**不得**用它解析 features/<id>/scope.yaml 路径，
   * 路径必须以目录名/当前分支的 Feature ID 为准，否则声明值与目录名不一致时会读到错误的文件。
   */
  declaredId: string | null;
  defined: { pages: string[]; sharedComponents: string[]; productModel: string[] };
}

export function checkScopeSchema(root: string, featureId: string): ScopeSchemaResult {
  const file = normalizePath(`features/${featureId}/scope.yaml`);
  const context: IssueContext = { file, issues: [] };
  const loaded = loadDocument(root, file);
  const defined = { pages: [] as string[], sharedComponents: [] as string[], productModel: [] as string[] };
  if (loaded.missing) {
    schemaIssue(context, '', `当前 Feature 缺少 ${file}。`, `补充 ${file}（可直接复制 templates/workspace 下的模板）。`);
    return { issues: context.issues, declaredId: null, defined };
  }
  reportDuplicateKeys(context, loaded.duplicateKeyMessages);
  if (!isPlainObject(loaded.data)) {
    schemaIssue(context, '', `${file} 的根节点必须是对象。`, '按 schemas/scope.schema.json 组织 feature 与 allowed。');
    return { issues: context.issues, declaredId: null, defined };
  }
  const document = loaded.data;
  rejectUnknownKeys(context, document, ['feature', 'allowed', 'forbidden', 'schema_version'], '');
  checkSchemaVersion(context, document);
  const feature = requireObject(context, document, 'feature', '');
  let declaredId: string | null = null;
  if (feature) {
    rejectUnknownKeys(context, feature, ['id', 'name'], 'feature.');
    if (requireString(context, feature, 'id', 'feature.')) {
      declaredId = feature.id as string;
      if (!/^REQ-[A-Z0-9][A-Z0-9-]*$/.test(declaredId)) {
        schemaIssue(context, 'feature.id', `feature.id 必须形如 REQ-XXXX，当前为 ${declaredId}。`, '将 feature.id 改为 REQ- 开头的大写 ID。');
      } else if (declaredId !== featureId) {
        schemaIssue(context, 'feature.id', `feature.id（${declaredId}）与所在目录名（${featureId}）不一致。`, `将 feature.id 改为 ${featureId}，或把文件移动到 features/${declaredId}/。`);
      }
    }
    requireString(context, feature, 'name', 'feature.');
  }
  const allowed = requireObject(context, document, 'allowed', '');
  if (allowed) {
    rejectUnknownKeys(context, allowed, ['pages', 'shared_components', 'product_model', 'paths'], 'allowed.');
    defined.pages = stringArray(context, allowed, 'pages', 'allowed.');
    defined.sharedComponents = stringArray(context, allowed, 'shared_components', 'allowed.');
    defined.productModel = stringArray(context, allowed, 'product_model', 'allowed.');
    stringArray(context, allowed, 'paths', 'allowed.');
  }
  stringArray(context, document, 'forbidden', '');
  return { issues: context.issues, declaredId, defined };
}

// ---------------------------------------------------------------------------
// product/pages.yaml（Page Registry，P0-3）
// ---------------------------------------------------------------------------

export interface PageRegistryRefs {
  routeIds: Set<string>;
  moduleIds: Set<string>;
  componentIds: Set<string>;
}

/**
 * Page Registry 的显式交叉校验。
 * 文件缺失属于 V0.1 兼容情形（不报错）；存在时校验结构、必填项、未知字段、重复文件映射与引用一致性。
 * 错误码：L007 结构 / L008 重复 / L009 非法引用 / L010 Registry 与实现文件不一致。
 */
export function checkPageRegistrySchema(root: string, refs: PageRegistryRefs): LintIssue[] {
  const file = 'product/pages.yaml';
  const context: IssueContext = { file, issues: [] };
  const loaded = loadDocument(root, file);
  if (loaded.missing) return context.issues;
  reportDuplicateKeys(context, loaded.duplicateKeyMessages);
  if (!isPlainObject(loaded.data)) {
    schemaIssue(context, '', `${file} 的根节点必须是对象。`, '按 schemas/pages.schema.json 组织 pages 映射。');
    return context.issues;
  }
  const document = loaded.data;
  rejectUnknownKeys(context, document, ['pages', 'schema_version'], '');
  checkSchemaVersion(context, document);
  const pages = requireObject(context, document, 'pages', '');
  if (!pages) return context.issues;

  const ownerOfFile = new Map<string, string>();
  for (const [id, value] of Object.entries(pages)) {
    const field = `pages.${id}`;
    if (!isPlainObject(value)) {
      schemaIssue(context, field, `${field} 必须是对象，当前类型 ${kindOf(value)}。`, `将 ${field} 改为 { name, file, route, module }。`);
      continue;
    }
    rejectUnknownKeys(context, value, ['name', 'file', 'route', 'module', 'spec', 'layout'], `${field}.`);
    const hasName = requireString(context, value, 'name', `${field}.`);
    const hasFile = requireString(context, value, 'file', `${field}.`);
    const hasRoute = requireString(context, value, 'route', `${field}.`);
    const hasModule = requireString(context, value, 'module', `${field}.`);
    void hasName;

    if (hasFile) {
      const implementation = normalizePath(value.file as string);
      if (!existsSync(join(root, implementation))) {
        context.issues.push({ code: 'L010', title: 'Page Registry Mismatch', message: `${field}.file 指向不存在的实现文件：${implementation}`, file, field: `${field}.file`, fix: `将 ${field}.file 改为真实存在的实现文件路径；若该文件已在本次变更中被删除，请同步更新或删除该页面登记。` });
      }
      const previous = ownerOfFile.get(implementation);
      if (previous) {
        duplicateIssue(context, `${field}.file`, `实现文件被多个页面登记：${implementation}（已被 ${previous} 登记）。`, `为 ${id} 指定各自的实现文件，或删除重复登记。`);
      } else {
        ownerOfFile.set(implementation, id);
      }
    }
    if (hasRoute && refs.routeIds.size > 0 && !refs.routeIds.has(value.route as string)) {
      referenceIssue(context, `${field}.route`, `${field}.route 指向不存在的路由：${value.route as string}`, `将其改为 product/routes.yaml 中已定义的 route id（${[...refs.routeIds].join('、')}）。`);
    }
    if (hasModule && refs.moduleIds.size > 0 && !refs.moduleIds.has(value.module as string)) {
      referenceIssue(context, `${field}.module`, `${field}.module 指向不存在的模块：${value.module as string}`, `将其改为 product/product.yaml 中已定义的模块 id（${[...refs.moduleIds].join('、')}）。`);
    }
    if ('spec' in value) {
      if (typeof value.spec !== 'string' || value.spec.trim() === '') {
        schemaIssue(context, `${field}.spec`, `${field}.spec 必须是非空字符串。`, `将 ${field}.spec 改为 spec 文件路径，或删除该字段。`);
      } else {
        const specPath = normalizePath(value.spec);
        if (!existsSync(join(root, specPath))) {
          context.issues.push({ code: 'L010', title: 'Page Registry Mismatch', message: `${field}.spec 指向不存在的 Spec：${specPath}`, file, field: `${field}.spec`, fix: `将 ${field}.spec 改为真实存在的 spec 路径，或删除该字段。` });
        }
      }
    }
    if ('layout' in value) {
      if (typeof value.layout !== 'string' || value.layout.trim() === '') {
        schemaIssue(context, `${field}.layout`, `${field}.layout 必须是非空字符串。`, `将 ${field}.layout 改为已登记的公共组件 id，或删除该字段。`);
      } else if (refs.componentIds.size > 0 && !refs.componentIds.has(value.layout as string)) {
        referenceIssue(context, `${field}.layout`, `${field}.layout 指向未登记的组件：${value.layout as string}`, `在 components/registry.yaml 中登记该组件，或改为已登记组件 id（${[...refs.componentIds].join('、')}）。`);
      }
    }
  }
  return context.issues;
}
