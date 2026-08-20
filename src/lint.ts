import { existsSync, readFileSync } from 'node:fs';
import { basename, join } from 'node:path';
import YAML from 'yaml';
import { changedFiles, currentFeature } from './git.js';
import { listFilesRecursive, normalizePath, readYaml } from './io.js';
import { authorizePath, componentNameFromPath, isProductPath } from './scope.js';
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
  const structural = routeChecks(root);
  const issues = [...structural.issues, ...terminologyChecks(root), ...componentChecks(root, changed)];
  const checks = [...structural.checks, 'Terminology references', 'Component registry'];
  if (feature) {
    const scope = loadScope(root, feature);
    if (scope) {
      for (const file of changed) {
        const authorization = authorizePath(file.path, scope);
        if (authorization.allowed) continue;
        if (isProductPath(file.path)) {
          issues.push({ code: 'L006', title: 'Product Model Unauthorized', message: `当前 Feature 未授权修改 Product Model：${file.path}`, file: file.path });
        } else {
          issues.push({ code: 'L001', title: 'Scope Violation', message: `当前 Feature Scope 未授权修改：${file.path}`, file: file.path });
        }
      }
      checks.push('Feature scope');
    }
  }
  const unique = new Map<string, LintIssue>();
  for (const issue of issues) unique.set(`${issue.code}:${issue.file ?? ''}:${issue.message}`, issue);
  return { pass: unique.size === 0, feature, changedFiles: changed, checks, issues: [...unique.values()] };
}

export function formatLint(result: LintResult): string {
  const lines = ['PRODUCT LINT', ''];
  if (result.pass) {
    lines.push('PASS', ...result.checks.map((check) => `✓ ${check}`), '', 'Result: PASS');
  } else {
    lines.push('FAIL');
    for (const issue of result.issues) {
      lines.push(`✗ ${issue.code} ${issue.title}`, issue.file ? `File: ${issue.file}` : '', issue.message, '');
    }
    lines.push('Result: BLOCKED');
  }
  return lines.filter((line, index, all) => line !== '' || all[index - 1] !== '').join('\n');
}
