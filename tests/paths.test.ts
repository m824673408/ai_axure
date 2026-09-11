import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { normalizePath, pathKey } from '../src/io.js';
import { loadPageRegistry, pageIdForFile } from '../src/registry.js';
import { authorizePath, componentNameFromPath, isProductPath, productModelKey } from '../src/scope.js';
import { initializeWorkspace } from '../src/workspace.js';
import type { ScopeModel } from '../src/types.js';

const roots: string[] = [];
const caseInsensitivePlatform = process.platform === 'win32' || process.platform === 'darwin';

function workspace(): string {
  const root = mkdtempSync(join(tmpdir(), 'proto-paths-'));
  roots.push(root);
  initializeWorkspace(root, true);
  return root;
}

afterEach(() => {
  for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true });
});

const scope: ScopeModel = {
  feature: { id: 'REQ-001', name: '路径测试' },
  allowed: { pages: ['attribution_rule'], shared_components: ['StatusTag'], product_model: ['routes'], paths: ['prototype/src/features/rule-history/**'] },
  forbidden: ['product/permissions.yaml'],
};

describe('§10.1 Windows 路径正规化', () => {
  it('normalizePath 统一分隔符并去掉开头的 ./', () => {
    expect(normalizePath('prototype\\src\\pages\\DashboardPage.tsx')).toBe('prototype/src/pages/DashboardPage.tsx');
    expect(normalizePath('./prototype/src/pages/DashboardPage.tsx')).toBe('prototype/src/pages/DashboardPage.tsx');
    expect(normalizePath('prototype/src/pages/DashboardPage.tsx')).toBe('prototype/src/pages/DashboardPage.tsx');
    expect(normalizePath(normalizePath('a\\b\\c.tsx'))).toBe('a/b/c.tsx');
  });

  it('pathKey 在同一路径的不同写法下产生同一比较键', () => {
    expect(pathKey('prototype\\src\\pages\\DashboardPage.tsx')).toBe(pathKey('prototype/src/pages/DashboardPage.tsx'));
    expect(pathKey('./prototype/src/pages/DashboardPage.tsx')).toBe(pathKey('prototype/src/pages/DashboardPage.tsx'));
  });

  it(caseInsensitivePlatform ? 'pathKey 在大小写不敏感平台折叠大小写' : 'pathKey 在大小写敏感平台保留大小写', () => {
    if (caseInsensitivePlatform) expect(pathKey('Prototype/SRC/Pages/DashboardPage.TSX')).toBe(pathKey('prototype/src/pages/dashboardpage.tsx'));
    else expect(pathKey('Prototype/SRC/Pages/DashboardPage.TSX')).not.toBe(pathKey('prototype/src/pages/dashboardpage.tsx'));
  });

  it('authorizePath 对反斜杠路径给出与正斜杠一致的判定', () => {
    for (const [windows, posix] of [
      ['product\\routes.yaml', 'product/routes.yaml'],
      ['product\\permissions.yaml', 'product/permissions.yaml'],
      ['specs\\attribution_rule.md', 'specs/attribution_rule.md'],
      ['prototype\\src\\components\\shared\\StatusTag.tsx', 'prototype/src/components/shared/StatusTag.tsx'],
      ['prototype\\src\\features\\rule-history\\index.tsx', 'prototype/src/features/rule-history/index.tsx'],
      ['.\\prototype\\src\\pages\\anything.tsx', 'prototype/src/pages/anything.tsx'],
    ]) {
      expect(authorizePath(windows, scope), windows).toEqual(authorizePath(posix, scope));
    }
    expect(authorizePath('product\\permissions.yaml', scope)).toMatchObject({ allowed: false, reason: 'forbidden' });
  });

  it('componentNameFromPath / isProductPath / productModelKey 支持反斜杠', () => {
    expect(componentNameFromPath('prototype\\src\\components\\shared\\StatusTag.tsx')).toBe('StatusTag');
    expect(componentNameFromPath('components\\shared\\StatusTag.tsx')).toBe('StatusTag');
    expect(isProductPath('product\\routes.yaml')).toBe(true);
    expect(productModelKey('product\\routes.yaml')).toBe('routes');
    expect(productModelKey('./product/navigation.yaml')).toBe('navigation');
  });

  it('Page Registry 的 file→page 反查支持反斜杠路径', () => {
    const root = workspace();
    const registry = loadPageRegistry(root);
    expect(pageIdForFile(registry, 'prototype\\src\\pages\\AttributionRulesPage.tsx')).toBe('attribution_rule');
    expect(pageIdForFile(registry, './prototype/src/pages/AttributionRulesPage.tsx')).toBe('attribution_rule');
  });

  it(caseInsensitivePlatform
    ? 'Registry 中大小写写错时仍能反查到页面（Windows 大小写不敏感）'
    : 'Registry 大小写不匹配时不反查（大小写敏感平台）', () => {
    const root = workspace();
    const path = join(root, 'product', 'pages.yaml');
    writeFileSync(path, readFileSync(path, 'utf8').replace('prototype/src/pages/AttributionRulesPage.tsx', 'prototype/src/pages/attributionrulespage.tsx'), 'utf8');
    const registry = loadPageRegistry(root);
    const resolved = pageIdForFile(registry, 'prototype/src/pages/AttributionRulesPage.tsx');
    if (caseInsensitivePlatform) {
      expect(resolved).toBe('attribution_rule');
      // 合法改动不得因大小写差异被误判为越权
      const pageScope: ScopeModel = { feature: { id: 'REQ-001', name: 'x' }, allowed: { pages: ['attribution_rule'], shared_components: [], product_model: [], paths: [] }, forbidden: [] };
      expect(authorizePath('prototype/src/pages/AttributionRulesPage.tsx', pageScope, registry)).toMatchObject({ allowed: true, reason: 'page_registry' });
    } else {
      expect(resolved).toBeNull();
    }
  });
});
