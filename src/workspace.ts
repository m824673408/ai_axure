import { cpSync, existsSync, mkdirSync, readFileSync, readdirSync, renameSync, unlinkSync, writeFileSync } from 'node:fs';
import { dirname, join, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { z } from 'zod';
import { ProtoError } from './errors.js';
import { commandExists, currentFeature, git, isGitRepository } from './git.js';
import { setupGithubGovernance } from './governance.js';
import { findWorkspace, isDirectoryEmpty, readYaml } from './io.js';
import { loadPageRegistry, registeredPathsForPage } from './registry.js';
import type { NavigationItem, ProductModel, ScopeModel, WorkspaceConfig } from './types.js';

const configSchema = z.object({
  workspace: z.object({ name: z.string().min(1), version: z.string().min(1), base_branch: z.string().min(1) }),
  paths: z.object({ product: z.string(), features: z.string(), prototype: z.string(), components: z.string() }),
  preview: z.object({ install_command: z.string(), command: z.string(), url: z.string() }),
  governance: z.object({
    scope_lock: z.literal('required'),
    github: z.object({ owner: z.string(), tool_repository: z.string(), tool_ref: z.string() }),
  }).optional(),
});

const productSchema = z.object({
  product: z.object({ id: z.string(), name: z.string(), version: z.string() }),
  modules: z.array(z.object({ id: z.string(), name: z.string() })),
});

const scopeSchema = z.object({
  feature: z.object({ id: z.string(), name: z.string() }),
  allowed: z.object({
    pages: z.array(z.string()).default([]),
    shared_components: z.array(z.string()).default([]),
    product_model: z.array(z.string()).default([]),
    paths: z.array(z.string()).default([]),
  }),
  forbidden: z.array(z.string()).default([]),
});

export function loadConfig(root = findWorkspace()): WorkspaceConfig {
  return configSchema.parse(readYaml(join(root, 'prototype.config.yaml'))) as WorkspaceConfig;
}

export function loadProduct(root: string): ProductModel {
  return productSchema.parse(readYaml(join(root, 'product', 'product.yaml'))) as ProductModel;
}

export function loadNavigation(root: string): NavigationItem[] {
  const model = readYaml<{ navigation?: NavigationItem[] }>(join(root, 'product', 'navigation.yaml'));
  return model.navigation ?? [];
}

export function loadScope(root: string, featureId?: string | null): ScopeModel | null {
  const id = featureId ?? currentFeature(root);
  if (!id) return null;
  const path = join(root, 'features', id, 'scope.yaml');
  if (!existsSync(path)) throw new ProtoError(`当前 Feature 缺少 scope.yaml：${id}`);
  return scopeSchema.parse(readYaml(path)) as ScopeModel;
}

export function listFeatures(root: string): Array<{ id: string; name: string }> {
  const directory = join(root, loadConfig(root).paths.features);
  if (!existsSync(directory)) return [];
  return readdirSync(directory, { withFileTypes: true })
    .filter((entry) => entry.isDirectory())
    .map((entry) => {
      const scopePath = join(directory, entry.name, 'scope.yaml');
      if (!existsSync(scopePath)) return { id: entry.name, name: entry.name };
      try {
        const scope = scopeSchema.parse(readYaml(scopePath)) as ScopeModel;
        return { id: scope.feature.id, name: scope.feature.name };
      } catch {
        return { id: entry.name, name: entry.name };
      }
    })
    .sort((a, b) => a.id.localeCompare(b.id));
}

export function templateRoot(): string {
  const candidates = [
    fileURLToPath(new URL('../templates/workspace', import.meta.url)),
    fileURLToPath(new URL('../../templates/workspace', import.meta.url)),
  ];
  const match = candidates.find((path) => existsSync(join(path, 'prototype.config.yaml')));
  if (!match) throw new ProtoError('CLI 安装包缺少 templates/workspace。');
  return match;
}

export function initializeWorkspace(targetValue: string, withGit = true, githubOwner?: string): string {
  const target = resolve(targetValue);
  if (existsSync(join(target, 'prototype.config.yaml'))) throw new ProtoError(`目标已经是 Prototype Workspace：${target}`);
  if (!isDirectoryEmpty(target)) throw new ProtoError(`目标目录不是空目录，已拒绝覆盖：${target}`);
  mkdirSync(target, { recursive: true });
  const sourceRoot = templateRoot();
  cpSync(sourceRoot, target, {
    recursive: true,
    filter: (source) => {
      const normalized = relative(sourceRoot, source).replaceAll('\\', '/');
      const segments = normalized.split('/');
      return !segments.includes('node_modules') && !segments.includes('dist') && !normalized.endsWith('.tsbuildinfo');
    },
  });
  const packedGitignore = join(target, 'gitignore.template');
  if (existsSync(packedGitignore)) {
    const gitignore = join(target, '.gitignore');
    if (existsSync(gitignore)) unlinkSync(packedGitignore);
    else renameSync(packedGitignore, gitignore);
  }
  if (withGit) {
    if (!commandExists('git')) throw new ProtoError('未找到 Git，无法初始化 Workspace。');
    if (githubOwner) setupGithubGovernance(target, githubOwner, 'v0.2.0-rc.5');
    git(target, ['init', '-b', 'main']);
    git(target, ['add', '--', '.']);
    git(target, ['-c', 'user.name=Prototype Workspace', '-c', 'user.email=prototype@local', 'commit', '-m', 'chore: initialize prototype workspace']);
  }
  return target;
}

/** 生成 YAML 数组：空数组写成 `[]`，非空写成缩进列表。 */
function yamlList(values: string[], indent: string): string {
  if (values.length === 0) return `${indent}[]`;
  return values.map((value) => `${indent}- ${value}`).join('\n');
}

function featureTemplate(id: string, name: string, pages: string[] = [], pagePaths: string[] = []): Record<string, string> {
  const paths = [...new Set([`features/${id}/**`, ...pagePaths])];
  const pagesYaml = pages.length === 0 ? ' []' : `\n${yamlList(pages, '    ')}`;
  return {
    'requirement.md': `# ${name}\n\n## 背景\n\n请补充需求背景。\n\n## 目标\n\n请补充目标。\n\n## 用户行为\n\n请补充用户行为。\n\n## 页面变化\n\n请补充页面变化。\n\n## 核心规则\n\n请补充核心规则。\n`,
    'scope.yaml': `feature:\n  id: ${id}\n  name: ${name}\n\nallowed:\n  pages:${pagesYaml}\n  shared_components: []\n  product_model: []\n  paths:\n${yamlList(paths, '    ')}\n\nforbidden:\n  - product/terminology.yaml\n  - product/permissions.yaml\n`,
    'scenarios.yaml': `scenarios: []\n`,
  };
}

/**
 * 把 `--page` 给出的 page ID 经 Page Registry 展开为具体文件路径（P0-2 方案 A）。
 * Registry 缺失或 page ID 未登记时给出可操作的错误，不生成"看起来授权了、实际匹配不上"的 scope。
 */
function expandPageAuthorizations(root: string, pages: string[]): { pages: string[]; paths: string[] } {
  const normalized = [...new Set(pages.map((page) => page.trim()).filter(Boolean))];
  if (normalized.length === 0) return { pages: [], paths: [] };
  const registry = loadPageRegistry(root);
  if (!registry.present) {
    throw new ProtoError('当前 Workspace 没有 product/pages.yaml（Page Registry），无法把 page ID 展开为真实实现文件。请先补上 Registry，或在 features/<ID>/scope.yaml 里用 allowed.paths 手工授权。');
  }
  const unknown = normalized.filter((page) => !registry.entries.has(page));
  if (unknown.length > 0) {
    const candidates = [...registry.entries.keys()].sort();
    throw new ProtoError(`未知 page ID：${unknown.join('、')}。可选值：${candidates.join('、') || '(Registry 中暂无页面)'}`);
  }
  const paths = normalized.flatMap((page) => registeredPathsForPage(registry, page));
  return { pages: normalized, paths: [...new Set(paths)] };
}

export function createFeature(root: string, id: string, name: string, pages: string[] = []): { pages: string[]; paths: string[] } {
  if (!/^REQ-[A-Z0-9][A-Z0-9-]*$/.test(id)) throw new ProtoError('Feature ID 必须使用 REQ- 开头，并仅包含大写字母、数字和连字符。');
  const config = loadConfig(root);
  if (!isGitRepository(root)) throw new ProtoError('当前 Workspace 不是 Git 仓库。');
  const branch = git(root, ['branch', '--show-current']);
  if (branch !== config.workspace.base_branch) throw new ProtoError(`必须从 ${config.workspace.base_branch} 创建 Feature，当前分支为 ${branch || '(detached)'}`);
  if (git(root, ['status', '--porcelain'])) throw new ProtoError('创建 Feature 前 Git Working Tree 必须干净。');
  const featureDir = join(root, config.paths.features, id);
  if (existsSync(featureDir) || git(root, ['show-ref', '--verify', `refs/heads/feature/${id}`], true)) throw new ProtoError(`Feature 已存在：${id}`);
  // 先解析授权（可能因未知 page ID 报错），再产生任何副作用（建分支/建目录）。
  const authorization = expandPageAuthorizations(root, pages);
  git(root, ['switch', '-c', `feature/${id}`]);
  mkdirSync(featureDir, { recursive: true });
  for (const [file, content] of Object.entries(featureTemplate(id, name, authorization.pages, authorization.paths))) writeFileSync(join(featureDir, file), content, 'utf8');
  return authorization;
}

export function updateYamlVersion(path: string, version: string): void {
  const source = readFileSync(path, 'utf8');
  const updated = source.replace(/(^\s*version:\s*).+$/m, `$1${version}`);
  if (updated === source) throw new ProtoError(`无法更新版本字段：${path}`);
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, updated, 'utf8');
}
