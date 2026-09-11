import { existsSync, readFileSync } from 'node:fs';
import { basename, join } from 'node:path';
import YAML from 'yaml';
import { changedFiles, currentFeature } from './git.js';
import { listFilesRecursive, normalizePath, readYaml } from './io.js';
import { authorizePath, componentNameFromPath, isProductPath } from './scope.js';
import { checkComponentRegistrySchema, checkNavigationSchema, checkProductSchema, checkRoutesSchema, checkScopeSchema, checkTerminologySchema } from './schema.js';
import { loadConfig, loadNavigation, loadScope } from './workspace.js';
import type { LintIssue, LintResult, NavigationItem } from './types.js';

function flattenPages(items: NavigationItem[]): string[] {
  return items.flatMap((item) => [item.page, ...flattenPages(item.children ?? [])].filter((value): value is string => Boolean(value)));
}

function routeChecks(root: string): { checks: string[]; issues: LintIssue[]; routeIds: Set<string> } {
  const path = join(root, 'product', 'routes.yaml');
  const source = readFileSync(path, 'utf8');
  const document = YAML.parseDocument(source, { uniqueKeys: true });
  const issues: LintIssue[] = [];
  for (const error of document.errors) issues.push({ code: 'L002', title: 'Duplicate Route', message: error.message, file: 'product/routes.yaml' });
  const data = document.toJS() as { routes?: Record<string, { path?: string }> };
  const routes = data.routes ?? {};
  const routeIds = new Set(Object.keys(routes));
  const paths = new Map<string, string>();
  for (const [id, route] of Object.entries(routes)) {
    if (!route.path) continue;
    const previous = paths.get(route.path);
    if (previous) issues.push({ code: 'L002', title: 'Duplicate Route', message: `路由 ${route.path} 同时被 ${previous} 与 ${id} 使用。`, file: 'product/routes.yaml' });
    else paths.set(route.path, id);
  }
  for (const page of flattenPages(loadNavigation(root))) {
    if (!routeIds.has(page)) issues.push({ code: 'L003', title: 'Missing Route', message: `navigation 引用了不存在的页面路由：${page}`, file: 'product/navigation.yaml' });
  }
  return { checks: ['Route structure', 'Navigation references'], issues, routeIds };
}

function terminologyChecks(root: string): LintIssue[] {
  const terms = readYaml<{ terms?: Record<string, unknown> }>(join(root, 'product', 'terminology.yaml')).terms ?? {};
  const issues: LintIssue[] = [];
  for (const full of listFilesRecursive(join(root, 'specs')).filter((path) => path.endsWith('.md'))) {
    const source = readFileSync(full, 'utf8');
    for (const match of source.matchAll(/term_key\s*[:：]\s*`?([a-zA-Z0-9_-]+)`?/g)) {
      const key = match[1];
      if (key && !(key in terms)) issues.push({ code: 'L003', title: 'Missing Product Reference', message: `页面 Spec 引用了不存在的 term_key：${key}`, file: normalizePath(full.slice(root.length + 1)) });
    }
  }
  return issues;
}

function componentChecks(root: string, changed: ReturnType<typeof changedFiles>): LintIssue[] {
  const registry = readYaml<{ components?: Record<string, unknown> }>(join(root, 'components', 'registry.yaml')).components ?? {};
  const issues: LintIssue[] = [];
  for (const file of changed.filter((item) => item.status === 'A' || item.status === 'U')) {
    const component = componentNameFromPath(file.path);
    if (component && !['index', 'README'].includes(component) && !(component in registry)) {
      issues.push({ code: 'L004', title: 'Missing Shared Component Registry', message: `新增公共组件 ${component} 未登记到 components/registry.yaml。`, file: file.path });
    }
  }
  return issues;
}

export function runLint(root: string): LintResult {
  const config = loadConfig(root);
  const feature = currentFeature(root);
  const changed = changedFiles(root, config.workspace.base_branch);

  // P0-1：先做 Schema 层校验（结构、必填项、未知字段、重复 ID、非法引用）
  const productSchema = checkProductSchema(root);
  const navigationSchema = checkNavigationSchema(root);
  const routesSchema = checkRoutesSchema(root, productSchema.moduleIds);
  const registrySchema = checkComponentRegistrySchema(root);
  const schemaIssues = [...productSchema.issues, ...navigationSchema.issues, ...routesSchema.issues, ...checkTerminologySchema(root), ...registrySchema.issues];
  for (const ref of navigationSchema.moduleRefs) {
    if (productSchema.moduleIds.size > 0 && !productSchema.moduleIds.has(ref.module)) {
      schemaIssues.push({ code: 'L009', title: 'Invalid Reference', message: `导航项引用了不存在的模块：${ref.module}`, file: 'product/navigation.yaml', field: ref.field, fix: `将 ${ref.field} 改为已定义模块 id，或在 product/product.yaml 中补充该模块。` });
    }
  }
  const checks = ['Schema: Product Model', 'Schema: Navigation', 'Schema: Routes', 'Schema: Terminology', 'Schema: Component Registry'];

  // 文件缺失时不再抛出，由上面的 Schema 校验给出可修复的错误
  const hasRoutes = existsSync(join(root, 'product', 'routes.yaml'));
  const hasNavigation = existsSync(join(root, 'product', 'navigation.yaml'));
  const hasTerminology = existsSync(join(root, 'product', 'terminology.yaml'));
  const structural = hasRoutes && hasNavigation ? routeChecks(root) : { checks: [] as string[], issues: [] as LintIssue[], routeIds: new Set<string>() };
  const issues = [...schemaIssues, ...structural.issues];
  issues.push(...(hasTerminology ? terminologyChecks(root) : []), ...(existsSync(join(root, 'components', 'registry.yaml')) ? componentChecks(root, changed) : []));
  checks.push(...structural.checks, 'Terminology references', 'Component registry');

  if (feature) {
    const scopeSchema = checkScopeSchema(root, feature);
    issues.push(...scopeSchema.issues);
    checks.push('Schema: Feature Scope');
    // 路径解析必须用当前分支的 Feature ID（目录名），不能用 scope.yaml 内声明的 id
    const scope = loadScope(root, feature);
    if (scope) {
      for (const file of changed) {
        const authorization = authorizePath(file.path, scope);
        if (authorization.allowed) continue;
        if (isProductPath(file.path)) {
          issues.push({ code: 'L006', title: 'Product Model Unauthorized', message: `当前 Feature 未授权修改 Product Model：${file.path}`, file: file.path, fix: '将文件加入 scope.yaml 的 allowed.product_model，或撤销对 Product Model 的修改。' });
        } else {
          issues.push({ code: 'L001', title: 'Scope Violation', message: `当前 Feature Scope 未授权修改：${file.path}`, file: file.path, fix: '将文件加入 scope.yaml 的 allowed.paths / allowed.pages，或撤销该文件修改。' });
        }
      }
      checks.push('Feature scope');
    }
  }
  const unique = new Map<string, LintIssue>();
  for (const issue of issues) unique.set(`${issue.code}:${issue.file ?? ''}:${issue.field ?? ''}:${issue.message}`, issue);
  return { pass: unique.size === 0, feature, changedFiles: changed, checks, issues: [...unique.values()] };
}

export function formatLint(result: LintResult): string {
  const lines = ['PRODUCT LINT', ''];
  if (result.pass) {
    lines.push('PASS', ...result.checks.map((check) => `✓ ${check}`), '', 'Result: PASS');
  } else {
    lines.push('FAIL');
    for (const issue of result.issues) {
      lines.push(`✗ ${issue.code} ${issue.title}`, issue.file ? `File: ${issue.file}` : '', issue.field ? `Field: ${issue.field}` : '', issue.message, issue.fix ? `Fix: ${issue.fix}` : '', '');
    }
    lines.push('Result: BLOCKED');
  }
  return lines.filter((line, index, all) => line !== '' || all[index - 1] !== '').join('\n');
}
