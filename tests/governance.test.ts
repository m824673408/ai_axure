import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { spawnSync } from 'node:child_process';
import { afterEach, describe, expect, it } from 'vitest';
import { changedFiles, currentBranch, currentFeature, git } from '../src/git.js';
import { governanceStatus, REQUIRED_STATUS_CONTEXT, setupGithubGovernance } from '../src/governance.js';
import { runLint } from '../src/lint.js';
import { initializeWorkspace } from '../src/workspace.js';

const roots: string[] = [];
const cli = resolve('src/cli.ts');
const tsxCli = resolve('node_modules/tsx/dist/cli.mjs');
function scratch(prefix: string): string { const root = mkdtempSync(join(tmpdir(), prefix)); roots.push(root); return root; }
function run(cwd: string, args: string[], env?: NodeJS.ProcessEnv) { return spawnSync(process.execPath, [tsxCli, cli, ...args], { cwd, encoding: 'utf8', env: { ...process.env, ...env } }); }

afterEach(() => {
  delete process.env.GITHUB_HEAD_REF;
  for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true });
});

describe('GitHub governance', () => {
  it('Git init 缺少 owner 时写入前拒绝，--no-git 保持可用', () => {
    const parent = scratch('proto-init-policy-');
    const blocked = run(parent, ['init', 'blocked']);
    expect(blocked.status).toBe(1);
    expect(blocked.stderr).toContain('--github-owner');
    expect(existsSync(join(parent, 'blocked'))).toBe(false);
    const noGit = run(parent, ['init', 'local', '--no-git']);
    expect(noGit.status).toBe(0);
    expect(existsSync(join(parent, 'local', 'prototype.config.yaml'))).toBe(true);
    expect(existsSync(join(parent, 'local', '.git'))).toBe(false);
  });

  it('setup 生成固定 CODEOWNERS 与 Prototype Gate，status 和 lint 可识别弱化', () => {
    const root = scratch('proto-governance-');
    initializeWorkspace(root, true, 'm824673408');
    let status = governanceStatus(root);
    expect(status.status).toBe('READY');
    expect(status.toolRef).toBe('v0.2.0-rc.3');
    expect(REQUIRED_STATUS_CONTEXT).toBe('Prototype Gate / check');
    const owners = readFileSync(join(root, '.github', 'CODEOWNERS'), 'utf8');
    for (const expected of ['/features/*/scope.yaml', '/features/*/scope.lock.json', '/product/**', '/components/registry.yaml', '/prototype.config.yaml', '/.gitignore', '/.github/**']) expect(owners).toContain(expected);
    const workflow = readFileSync(join(root, '.github', 'workflows', 'prototype-gate.yml'), 'utf8');
    expect(workflow).toContain('name: Prototype Gate');
    expect(workflow).toContain('  check:');
    expect(workflow).toContain('node-version: 22');
    expect(workflow).toContain('PROTOTYPE_TOOL_REPOSITORY: https://github.com/m824673408/ai_axure.git');
    expect(workflow).toContain('PROTOTYPE_TOOL_REF: v0.2.0-rc.3');
    expect(workflow).toContain('git clone --depth 1 --branch "$PROTOTYPE_TOOL_REF"');
    expect(workflow).toContain('npm ci --prefix "$RUNNER_TEMP/ai_axure" --include=dev');
    expect(workflow).toContain('npm install --global "$RUNNER_TEMP/ai_axure" --ignore-scripts');
    expect(workflow).toContain('fetch-depth: 0');
    expect(workflow).toContain('proto check --out');
    expect(workflow).toContain('if: always()');
    writeFileSync(join(root, '.github', 'CODEOWNERS'), '/product/** @someone-else\n', 'utf8');
    status = governanceStatus(root);
    expect(status.status).toBe('STALE');
    const lint = runLint(root);
    expect(lint.pass).toBe(false);
    expect(lint.issues.some((issue) => issue.code === 'L015' && issue.file === '.github/CODEOWNERS')).toBe(true);
  });

  it('setup 对自定义治理文件拒绝覆盖', () => {
    const root = scratch('proto-governance-conflict-');
    initializeWorkspace(root, true);
    mkdirSync(join(root, '.github'), { recursive: true });
    writeFileSync(join(root, '.github', 'CODEOWNERS'), '# custom\n', 'utf8');
    expect(() => setupGithubGovernance(root, 'm824673408', 'v0.2.0-rc.2')).toThrow(/拒绝覆盖/);
    expect(readFileSync(join(root, '.github', 'CODEOWNERS'), 'utf8')).toBe('# custom\n');
  });

  it('detached HEAD 优先使用 GITHUB_HEAD_REF，并可回退 origin/main', () => {
    const source = scratch('proto-ci-source-');
    const origin = scratch('proto-ci-origin-');
    git(origin, ['init', '--bare']);
    initializeWorkspace(source, true);
    git(source, ['remote', 'add', 'origin', origin]);
    git(source, ['push', '-u', 'origin', 'main']);
    git(source, ['switch', '-c', 'feature/REQ-CI-001']);
    writeFileSync(join(source, 'ci.txt'), 'ci\n', 'utf8');
    git(source, ['add', '--', 'ci.txt']);
    git(source, ['-c', 'user.name=Test', '-c', 'user.email=test@local', 'commit', '-m', 'test: ci head']);
    git(source, ['switch', '--detach', 'HEAD']);
    git(source, ['branch', '-D', 'main']);
    process.env.GITHUB_HEAD_REF = 'feature/REQ-CI-001';
    expect(currentBranch(source)).toBe('feature/REQ-CI-001');
    expect(currentFeature(source)).toBe('REQ-CI-001');
    expect(changedFiles(source, 'main').map((file) => file.path)).toContain('ci.txt');
  });

  it('CLI governance status --json 提供稳定机器输出', () => {
    const root = scratch('proto-governance-cli-');
    initializeWorkspace(root, true, 'm824673408');
    const result = run(root, ['governance', 'status', '--json']);
    expect(result.status).toBe(0);
    const body = JSON.parse(result.stdout);
    expect(body).toMatchObject({ status: 'READY', enabled: true, owner: 'm824673408', toolRef: 'v0.2.0-rc.3' });
  });
});
