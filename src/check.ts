import { spawnSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { createDiff } from './diff.js';
import { ProtoError } from './errors.js';
import { baseReference, currentBranch, currentFeature, git, isGitRepository } from './git.js';
import { runLint } from './lint.js';
import { duplicateCapabilityKeys, loadComponentRegistry, loadPageRegistry } from './registry.js';
import { loadConfig } from './workspace.js';

/**
 * P1：`proto check` —— 合并前的**一次性**检查（用户 2026-09-11 决策：单命令，不做 proto review）。
 *
 * 设计约束（见 evidence/v02-dev/cli-command-design.md §五）：
 * - 只读：不 commit / push / merge / 解冲突；不改任何工作区文件；
 * - 复用既有确定性能力（runLint / createDiff / Registry），不重新实现判定逻辑；
 * - 退出码 0 = 全部通过，1 = 存在阻塞项，供 CI 直接使用；`--json` / `--out` 供机器读取。
 */

export type CheckStatus = 'PASS' | 'FAIL' | 'SKIP';

export interface CheckSection {
  id: string;
  title: string;
  status: CheckStatus;
  detail: string;
  /** 阻塞项：规则码 + 人话（与 P0-1 / P0-4 的错误信息风格一致）。 */
  problems: string[];
}

export interface CheckResult {
  contractVersion: '1';
  generatedAt: string;
  workspace: string;
  base: { branch: string; commit: string };
  branch: string;
  feature: string | null;
  baseBranchDirty: boolean;
  uncommitted: number;
  sections: CheckSection[];
  risks: string[];
  pass: boolean;
}

export interface CheckOptions {
  /** false = `--no-build`，跳过第 4 段 Prototype Build。 */
  build?: boolean;
  /** 本次检查忽略的工作区相对路径，例如 `--out` 自己生成的报告。 */
  ignoredPaths?: string[];
}

function buildSection(root: string, prototypePath: string): CheckSection {
  const prototypeDir = join(root, prototypePath);
  if (!existsSync(join(prototypeDir, 'package.json'))) {
    return { id: 'build', title: 'Prototype Build', status: 'SKIP', detail: '工作区没有 Prototype 工程（跳过）', problems: [] };
  }
  const result = spawnSync('npm run build', { cwd: prototypeDir, shell: true, encoding: 'utf8', timeout: 15 * 60 * 1000 });
  const output = `${result.stdout ?? ''}${result.stderr ?? ''}`;
  if (result.status === 0) return { id: 'build', title: 'Prototype Build', status: 'PASS', detail: 'npm run build（exit 0）', problems: [] };
  const tail = output.split('\n').map((line) => line.trim()).filter(Boolean).slice(-12);
  return { id: 'build', title: 'Prototype Build', status: 'FAIL', detail: `npm run build（exit ${result.status ?? 'null'}）`, problems: tail.length > 0 ? tail : ['构建失败且没有输出'] };
}

export function runCheck(root: string, options: CheckOptions = {}): CheckResult {
  if (!isGitRepository(root)) throw new ProtoError('当前 Workspace 不是 Git 仓库，proto check 需要 Git 历史来判定变更与合并基线。');
  const config = loadConfig(root);
  const baseBranch = config.workspace.base_branch;
  const branch = currentBranch(root);
  const feature = currentFeature(root);
  const ignoredPaths = [...new Set(options.ignoredPaths ?? [])];
  const diff = createDiff(root, { ignoredPaths });
  const lint = runLint(root, { ignoredPaths });

  // ① Schema & Lint
  const lintSection: CheckSection = {
    id: 'lint',
    title: 'Schema & Lint',
    status: lint.pass ? 'PASS' : 'FAIL',
    detail: `${lint.checks.length} 项检查，${lint.issues.length} 个问题`,
    problems: lint.issues.map((issue) => `${issue.code} ${issue.message}${issue.fix ? `\n    修正：${issue.fix}` : ''}`),
  };

  // ② Product Diff（含 Scope 授权判定）
  // 在基础分支上 changedFiles 恒为空（见 src/git.ts），Scope 判定没有意义——报 PASS 会误导，
  // 因此如实标为 SKIP（不适用），把"当前处在基础分支"这件事交给头部 ⚠ 与 baseBranchDirty 字段。
  const onBaseBranch = branch === baseBranch;
  const scopeBlocked = diff.scope.status !== 'PASS';
  const diffSection: CheckSection = onBaseBranch
    ? {
        id: 'diff',
        title: 'Product Diff',
        status: 'SKIP',
        detail: `不适用：当前在基础分支 ${baseBranch} 上（changedFiles 恒为空，任何"变更"结论都不代表合并影响）`,
        problems: [],
      }
    : {
        id: 'diff',
        title: 'Product Diff',
        status: scopeBlocked || diff.scope.error ? 'FAIL' : 'PASS',
        detail: `Changed Files ${diff.changedFiles.length} / Product Model ${diff.productModel.length} / Shared Components ${diff.sharedComponents.length} / Scope ${diff.scope.status}（检查 ${diff.scope.checkedFiles} 个文件）`,
        problems: [
          ...(diff.scope.error ? [`Scope 判定不可用：${diff.scope.error}`] : []),
          ...diff.scope.scopeViolations.map((violation) => `${violation.code} ${violation.file}\n    ${violation.message}`),
          ...(scopeBlocked && !diff.scope.error && diff.scope.scopeViolations.length === 0 ? ['Scope 判定为 BLOCKED，但没有给出具体违规文件（请报告为工具缺陷）。'] : []),
        ],
      };

  // ③ Registry 冲突
  const pageRegistry = loadPageRegistry(root);
  const componentRegistry = loadComponentRegistry(root);
  const duplicates = duplicateCapabilityKeys(componentRegistry);
  const registrySection: CheckSection = {
    id: 'registry',
    title: 'Registry 冲突',
    status: duplicates.length === 0 ? 'PASS' : 'FAIL',
    detail: `${pageRegistry.present ? `Page Registry ${pageRegistry.entries.size} 个页面` : '无 Page Registry（沿用 V0.1 兜底推导）'}；${componentRegistry.present ? `Component Registry ${componentRegistry.entries.size} 个组件` : '无 Component Registry'}；重复 capability_key ${duplicates.length} 个`,
    problems: duplicates.map((item) => `L011 capability_key 重复：${item.capabilityKey}\n    归属：${item.owners.join('、')}`),
  };

  // ④ Prototype Build
  const buildResult: CheckSection = options.build === false
    ? { id: 'build', title: 'Prototype Build', status: 'SKIP', detail: '--no-build（已按要求跳过）', problems: [] }
    : buildSection(root, config.paths.prototype);

  // ⑤ 风险提示（只提示，不阻塞）
  const baseCommit = git(root, ['rev-parse', '--short', baseReference(root, baseBranch)], true);
  const allUncommitted = git(root, ['status', '--porcelain'], true).split('\n').filter(Boolean).length;
  const ignoredUncommitted = ignoredPaths.reduce((count, path) => count + git(root, ['status', '--porcelain', '--', path], true).split('\n').filter(Boolean).length, 0);
  const uncommitted = Math.max(0, allUncommitted - ignoredUncommitted);
  const baseBranchDirty = branch === baseBranch && uncommitted > 0;
  const risks = diff.risks.map((risk) => `${risk.code} ${risk.title}${risk.file ? `（${risk.file}）` : ''}`);
  const riskSection: CheckSection = {
    id: 'risks',
    title: '风险提示',
    status: 'PASS',
    detail: `${diff.risks.length} 项`,
    problems: risks,
  };

  const sections = [lintSection, diffSection, registrySection, buildResult, riskSection];
  return {
    contractVersion: '1',
    generatedAt: new Intl.DateTimeFormat('sv-SE', { timeZone: 'Asia/Shanghai', dateStyle: 'short', timeStyle: 'medium' }).format(new Date()),
    workspace: root,
    base: { branch: baseBranch, commit: baseCommit || '(未知)' },
    branch,
    feature,
    baseBranchDirty,
    uncommitted,
    sections,
    risks,
    pass: !baseBranchDirty && sections.every((section) => section.status !== 'FAIL'),
  };
}

export function formatCheck(result: CheckResult): string {
  const lines: string[] = [
    'MERGE CHECK（合并前一次性检查）',
    '',
    `Workspace: ${result.workspace}`,
    `Base:      ${result.base.branch} @ ${result.base.commit}`,
    `Branch:    ${result.branch}`,
    `Feature:   ${result.feature ?? '(未识别：当前 Branch 不是 feature/*)'}`,
    `Time:      ${result.generatedAt}`,
  ];
  if (result.baseBranchDirty) {
    lines.push('', `⚠ 基础分支不干净：当前就在 ${result.base.branch} 上且有 ${result.uncommitted} 个未提交变更。基础分支上 Product Diff 不适用（changedFiles 为空），本次检查的"变更"相关结论均不代表合并影响。`);
  }
  lines.push('');
  result.sections.forEach((section, index) => {
    // 不用列对齐：中文标题是双宽字符，按字符数 padEnd 在终端里反而错位；状态放最前面最易扫读。
    lines.push(`[${index + 1}/${result.sections.length}] ${section.status} — ${section.title}：${section.detail}`);
    const bullet = section.status === 'PASS' ? '  · ' : '  ✗ ';
    for (const problem of section.problems) lines.push(`${bullet}${problem}`);
  });
  lines.push('', result.pass ? 'Result: PASS' : 'Result: FAIL（存在阻塞项，请先处理上面的问题）');
  return lines.join('\n');
}
