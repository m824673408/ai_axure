import { basename } from 'node:path';
import { minimatch } from 'minimatch';
import { normalizePath, pathKey } from './io.js';
import { pageIdForFile, registeredPathsForPage, type PageRegistry } from './registry.js';
import type { ScopeModel } from './types.js';

function matches(path: string, pattern: string): boolean {
  const normalized = normalizePath(pattern);
  return path === normalized || minimatch(path, normalized, { dot: true, nocase: process.platform === 'win32' });
}

export function componentNameFromPath(path: string): string | null {
  const normalized = normalizePath(path);
  const match = normalized.match(/(?:^components\/shared\/|^prototype\/src\/components\/shared\/)([^/]+)/);
  if (!match?.[1]) return null;
  return basename(match[1]).replace(/\.(tsx?|jsx?)$/, '');
}

export function isProductPath(path: string): boolean {
  return normalizePath(path).startsWith('product/');
}

export function productModelKey(path: string): string {
  return basename(normalizePath(path)).replace(/\.ya?ml$/i, '');
}

/**
 * 判断路径是否被当前 Feature Scope 授权。
 *
 * P0-3 起可传入 Page Registry：当 Registry 把 page id 显式映射到实现文件 / spec 时，
 * `allowed.pages: [attribution_rule]` 即可授权 `prototype/src/pages/AttributionRulesPage.tsx`，
 * 不再要求文件名与 page id 一致（这是 V0.1 的实际摩擦来源，见 P0-2 背景）。
 * 不传 Registry 时行为与 V0.1 完全一致。
 */
export function authorizePath(pathValue: string, scope: ScopeModel, pages?: PageRegistry): { allowed: boolean; reason: string } {
  const path = normalizePath(pathValue);
  if (scope.forbidden.some((pattern) => matches(path, pattern))) return { allowed: false, reason: 'forbidden' };
  if (path === `features/${scope.feature.id}` || path.startsWith(`features/${scope.feature.id}/`)) return { allowed: true, reason: 'feature' };
  if (isProductPath(path)) {
    const key = productModelKey(path);
    const allowed = scope.allowed.product_model.some((item) => item === key || item === `${key}.yaml` || item === path);
    return { allowed, reason: allowed ? 'product_model' : 'product_model_unauthorized' };
  }
  const component = componentNameFromPath(path);
  if (component) {
    const allowed = scope.allowed.shared_components.includes(component);
    return { allowed, reason: allowed ? 'shared_component' : 'shared_component_unauthorized' };
  }
  if (path === 'components/registry.yaml' && scope.allowed.shared_components.length > 0) return { allowed: true, reason: 'component_registry' };
  // P0-3：Registry 驱动的页面授权
  const registeredPage = pages?.present ? pageIdForFile(pages, path) : null;
  if (pages?.present) {
    for (const page of scope.allowed.pages) {
      if (registeredPage === page) return { allowed: true, reason: 'page_registry' };
      if (registeredPathsForPage(pages, page).some((registered) => pathKey(registered) === pathKey(path))) return { allowed: true, reason: 'page_registry' };
    }
  }
  for (const page of scope.allowed.pages) {
    const pagePatterns = [`pages/${page}/**`, `pages/${page}.*`, `specs/${page}.md`, `prototype/src/pages/${page}/**`, `prototype/src/pages/${page}.*`];
    if (pagePatterns.some((pattern) => matches(path, pattern))) return { allowed: true, reason: 'page' };
  }
  if (scope.allowed.paths.some((pattern) => matches(path, pattern))) return { allowed: true, reason: 'path' };
  if (registeredPage) return { allowed: false, reason: 'page_registry_unauthorized' };
  return { allowed: false, reason: 'scope' };
}
