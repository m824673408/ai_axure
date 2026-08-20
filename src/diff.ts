import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { changedFiles, fullDiff } from './git.js';
import { loadConfig, loadProduct, loadScope } from './workspace.js';
import type { ChangedFile } from './types.js';

export interface ProductDiff {
  changedFiles: ChangedFile[];
  productModel: ChangedFile[];
  pages: ChangedFile[];
  sharedComponents: ChangedFile[];
  featureFiles: ChangedFile[];
  prototypeFiles: ChangedFile[];
}

export function createDiff(root: string): ProductDiff {
  const config = loadConfig(root);
  const files = changedFiles(root, config.workspace.base_branch);
  const select = (predicate: (path: string) => boolean) => files.filter((file) => predicate(file.path));
  return {
    changedFiles: files,
    productModel: select((path) => path.startsWith('product/')),
    pages: select((path) => path.startsWith('pages/') || path.startsWith('specs/') || path.includes('/pages/')),
    sharedComponents: select((path) => path.startsWith('components/shared/') || path.startsWith('prototype/src/components/shared/')),
    featureFiles: select((path) => path.startsWith('features/')),
    prototypeFiles: select((path) => path.startsWith('prototype/')),
  };
}

export function formatDiff(diff: ProductDiff): string {
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
  return lines.join('\n').trimEnd();
}

export function buildSemanticPrompt(root: string): string {
  const config = loadConfig(root);
  const scope = loadScope(root);
  const feature = scope?.feature.id ?? 'None';
  const requirementPath = scope ? join(root, 'features', feature, 'requirement.md') : null;
  const requirement = requirementPath ? readFileSync(requirementPath, 'utf8') : '无当前 Feature。';
  return `你是 Product Owner Review 助手。仅根据输入生成中文 Product Diff，不判断是否允许 Merge。\n\n## 输出结构\n# Product Diff\n## 页面\n## 交互\n## 产品规则\n## Product Model\n## Shared Component\n## 风险\n\n## Product\n${JSON.stringify(loadProduct(root), null, 2)}\n\n## Feature\n${feature}\n\n## Requirement\n${requirement}\n\n## Scope\n${JSON.stringify(scope, null, 2)}\n\n## Deterministic Diff\n${formatDiff(createDiff(root))}\n\n## Git Diff\n${fullDiff(root, config.workspace.base_branch) || '(无已跟踪文件差异；请结合文件列表判断未跟踪文件。)'}`;
}
