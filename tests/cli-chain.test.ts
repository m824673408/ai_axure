import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { spawnSync } from 'node:child_process';
import { afterEach, describe, expect, it } from 'vitest';
import { git } from '../src/git.js';

/**
 * §10.2 CLI 集成测试：在临时目录完整执行
 * init → feature create → 自动生成 Scope → 合法页面修改 → lint PASS
 * → 越界修改 → lint BLOCKED → diff text/json → build prototype
 *
 * 断言退出码、错误 code、精确文件路径与 JSON 字段，而不是比较模糊日志。
 * `build prototype` 需要 npm install，默认跳过；用 PROTO_CHAIN_BUILD=1 运行完整链（证据运行使用该开关）。
 */

const parents: string[] = [];
const cli = resolve('src/cli.ts');
const tsxCli = resolve('node_modules/tsx/dist/cli.mjs');

/** §8 P0-5 要求 Product Diff 必须输出的语义字段（JSON 合同） */
const REQUIRED_DIFF_FIELDS = [
  'contractVersion',
  'features',
  'changedPages',
  'navigation',
  'routes',
  'sharedComponentDiff',
  'scope',
  'requirementReplacements',
  'undefinedRules',
  'risks',
];

const SCOPE = `feature:
  id: REQ-CHAIN-001
  name: 端到端链路

allowed:
  pages:
    - attribution_rule
  shared_components: []
  product_model: []
  paths:
    - features/REQ-CHAIN-001/**

forbidden:
  - product/terminology.yaml
`;

function run(cwd: string, args: string[]) {
  return spawnSync(process.execPath, [tsxCli, cli, ...args], { cwd, encoding: 'utf8' });
}

function append(root: string, relative: string, text: string): void {
  writeFileSync(join(root, relative), `${readFileSync(join(root, relative), 'utf8')}\n${text}\n`, 'utf8');
}

afterEach(() => {
  for (const parent of parents.splice(0)) rmSync(parent, { recursive: true, force: true });
});

describe('§10.2 CLI 端到端链', () => {
  it('init → feature create → 合法修改 PASS → 越界 BLOCKED → diff text/json', () => {
    const parent = mkdtempSync(join(tmpdir(), 'proto-chain-'));
    parents.push(parent);
    const root = join(parent, 'workspace');

    // 1) init
    const init = run(parent, ['init', 'workspace']);
    expect(init.status, init.stderr).toBe(0);
    expect(init.stdout).toContain('Prototype Workspace initialized');
    expect(existsSync(join(root, 'prototype.config.yaml'))).toBe(true);
    expect(existsSync(join(root, 'product', 'pages.yaml'))).toBe(true);

    // 2) feature create（自动生成 Scope 模板）
    const create = run(root, ['feature', 'create', 'REQ-CHAIN-001', '--name', '端到端链路']);
    expect(create.status, create.stderr).toBe(0);
    expect(create.stdout).toContain('feature/REQ-CHAIN-001');
    expect(git(root, ['branch', '--show-current'])).toBe('feature/REQ-CHAIN-001');
    const scopePath = join(root, 'features', 'REQ-CHAIN-001', 'scope.yaml');
    expect(existsSync(scopePath)).toBe(true);
    expect(readFileSync(scopePath, 'utf8')).toContain('REQ-CHAIN-001');

    // 3) 授权页面（Page Registry 把 attribution_rule 映射到真实实现文件）
    writeFileSync(scopePath, SCOPE, 'utf8');
    append(root, join('prototype', 'src', 'pages', 'AttributionRulesPage.tsx'), '// 合法改动');
    const lintPass = run(root, ['lint']);
    expect(lintPass.stdout).toContain('Result: PASS');
    expect(lintPass.status).toBe(0);

    // 4) 越界修改（第一类：未授权的页面文件）
    append(root, join('prototype', 'src', 'pages', 'MediaConfigPage.tsx'), '// 越界改动');
    const lintBlocked = run(root, ['lint']);
    expect(lintBlocked.status).toBe(1);
    expect(lintBlocked.stdout).toContain('L001 Scope Violation');
    expect(lintBlocked.stdout).toContain('File: prototype/src/pages/MediaConfigPage.tsx');
    expect(lintBlocked.stdout).toContain('Result: BLOCKED');

    // 4b) 越界修改（第二类：未授权的 Product Model）
    append(root, join('product', 'routes.yaml'), '# 越界改动');
    const lintProduct = run(root, ['lint']);
    expect(lintProduct.status).toBe(1);
    expect(lintProduct.stdout).toContain('L006 Product Model Unauthorized');
    expect(lintProduct.stdout).toContain('File: product/routes.yaml');
    // 两类越界必须同时完整报告
    expect(lintProduct.stdout).toContain('L001 Scope Violation');

    // 5) lint --json 合同
    const lintJson = run(root, ['lint', '--json']);
    expect(lintJson.status).toBe(1);
    const lintPayload = JSON.parse(lintJson.stdout) as {
      pass: boolean;
      feature: string;
      checks: string[];
      issues: Array<{ code: string; file?: string; message: string }>;
      changedFiles: Array<{ path: string }>;
    };
    expect(lintPayload.pass).toBe(false);
    expect(lintPayload.feature).toBe('REQ-CHAIN-001');
    expect(lintPayload.issues.some((issue) => issue.code === 'L001' && issue.file === 'prototype/src/pages/MediaConfigPage.tsx')).toBe(true);
    expect(lintPayload.issues.some((issue) => issue.code === 'L006' && issue.file === 'product/routes.yaml')).toBe(true);
    expect(lintPayload.changedFiles.map((file) => file.path)).toContain('features/REQ-CHAIN-001/scope.yaml');
    expect(lintPayload.checks).toContain('Schema: Page Registry');

    // 6) diff text
    const diffText = run(root, ['diff']);
    expect(diffText.status).toBe(0);
    expect(diffText.stdout).toContain('REQ-CHAIN-001');

    // 7) diff --json 合同：字段齐全且两次调用完全一致（稳定）
    const diffJson = run(root, ['diff', '--json']);
    expect(diffJson.status).toBe(0);
    const diffPayload = JSON.parse(diffJson.stdout) as Record<string, unknown>;
    expect(Object.keys(diffPayload)).toEqual(expect.arrayContaining(REQUIRED_DIFF_FIELDS));
    expect(JSON.stringify(diffPayload)).toContain('prototype/src/pages/MediaConfigPage.tsx');
    const diffAgain = run(root, ['diff', '--json']);
    expect(diffAgain.stdout).toBe(diffJson.stdout);

    // 8) 撤销越界后回到 PASS（可恢复性）
    git(root, ['checkout', '--', 'prototype/src/pages/MediaConfigPage.tsx', 'product/routes.yaml'], true);
    const restored = run(root, ['lint']);
    expect(restored.stdout).toContain('Result: PASS');
    expect(restored.status).toBe(0);
  }, 180_000);

  it.skipIf(process.env.PROTO_CHAIN_BUILD !== '1')('build prototype（完整链，需 npm install）', () => {
    const parent = mkdtempSync(join(tmpdir(), 'proto-chain-build-'));
    parents.push(parent);
    const root = join(parent, 'workspace');
    expect(run(parent, ['init', 'workspace']).status).toBe(0);
    expect(run(root, ['feature', 'create', 'REQ-CHAIN-002', '--name', '构建链路']).status).toBe(0);
    expect(run(root, ['lint']).status).toBe(0);
    // 依赖安装在 prototype 目录内执行：不使用 npm --prefix（相对前缀在 Windows 上会被解析到 cwd 之外）
    const app = join(root, 'prototype');
    const npm = process.platform === 'win32' ? 'npm.cmd' : 'npm';
    const install = spawnSync(npm, ['install', '--no-audit', '--no-fund'], { cwd: app, encoding: 'utf8', shell: process.platform === 'win32' });
    expect(install.status, install.stderr?.slice(-800)).toBe(0);
    const build = spawnSync(npm, ['run', 'build'], { cwd: app, encoding: 'utf8', shell: process.platform === 'win32' });
    expect(build.status, `${build.stdout?.slice(-500)}\n${build.stderr?.slice(-800)}`).toBe(0);
    expect(existsSync(join(app, 'dist', 'index.html'))).toBe(true);
  }, 900_000);
});
