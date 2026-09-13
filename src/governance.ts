import { existsSync, mkdirSync, readFileSync, unlinkSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { ProtoError } from './errors.js';
import { git, isGitRepository } from './git.js';
import { readYaml, writeYaml } from './io.js';

export const REQUIRED_STATUS_CONTEXT = 'Prototype Gate / check';

export type GovernanceState = 'READY' | 'MISSING' | 'STALE';
export interface GovernanceStatus {
  status: GovernanceState;
  enabled: boolean;
  owner: string | null;
  toolRepository: string | null;
  toolRef: string | null;
  issues: Array<{ file: string; message: string }>;
}

function normalizeOwner(owner: string): string {
  const value = owner.trim().replace(/^@/, '');
  if (!/^[A-Za-z0-9](?:[A-Za-z0-9-]{0,38})$/.test(value)) throw new ProtoError(`无效 GitHub owner：${owner}`);
  return value;
}

function normalizeToolRef(toolRef: string): string {
  const value = toolRef.trim();
  if (!/^v\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?$/.test(value)) throw new ProtoError(`--tool-ref 必须是不可变版本 Tag，例如 v0.2.0-rc.2：${toolRef}`);
  return value;
}

export function codeownersContent(owner: string): string {
  const actor = `@${normalizeOwner(owner)}`;
  return [
    `# Prototype governance: protected contracts require ${actor} review.`,
    `/features/*/scope.yaml ${actor}`,
    `/features/*/scope.lock.json ${actor}`,
    `/product/** ${actor}`,
    `/components/registry.yaml ${actor}`,
    `/prototype.config.yaml ${actor}`,
    `/.gitignore ${actor}`,
    `/.github/** ${actor}`,
    '',
  ].join('\n');
}

export function workflowContent(owner: string, toolRef: string): string {
  const repository = `${normalizeOwner(owner)}/ai_axure`;
  const ref = normalizeToolRef(toolRef);
  return `name: Prototype Gate

on:
  pull_request:
  push:
    branches: [main]

permissions:
  contents: read

jobs:
  check:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
        with:
          fetch-depth: 0
      - uses: actions/setup-node@v4
        with:
          node-version: 22
      - name: Install pinned Prototype CLI
        run: npm install --global "git+https://github.com/${repository}.git#${ref}"
      - name: Install Prototype dependencies
        run: npm --prefix prototype install --no-audit --no-fund
      - name: Run Prototype Gate
        env:
          GITHUB_HEAD_REF: \${{ github.head_ref }}
        run: proto check --out output/governance/check.json
      - name: Upload check report
        if: always()
        uses: actions/upload-artifact@v4
        with:
          name: prototype-check-report
          path: output/governance/check.json
          if-no-files-found: warn
`;
}

const legacyWorkflow = `name: Product Lint

on:
  pull_request:
  push:
    branches: [main]

jobs:
  lint:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
        with:
          fetch-depth: 0
      - uses: actions/setup-node@v4
        with:
          node-version: 22
      - run: npm install --global product-prototype-core
      - run: proto lint
      - run: npm --prefix prototype install
      - run: npm --prefix prototype run build
`;

function githubRemote(root: string): boolean {
  if (!isGitRepository(root)) return false;
  const top = git(root, ['rev-parse', '--show-toplevel'], true);
  if (!top || resolve(top).toLowerCase() !== resolve(root).toLowerCase()) return false;
  return /github\.com[/:]/i.test(git(root, ['remote', 'get-url', 'origin'], true));
}

export function governanceStatus(root: string): GovernanceStatus {
  const raw = readYaml<Record<string, unknown>>(join(root, 'prototype.config.yaml'));
  const governance = (raw.governance && typeof raw.governance === 'object') ? raw.governance as Record<string, unknown> : null;
  const github = (governance?.github && typeof governance.github === 'object') ? governance.github as Record<string, unknown> : null;
  const enabled = Boolean(governance) || githubRemote(root);
  if (!enabled) return { status: 'MISSING', enabled: false, owner: null, toolRepository: null, toolRef: null, issues: [] };
  const owner = typeof github?.owner === 'string' ? github.owner : null;
  const toolRepository = typeof github?.tool_repository === 'string' ? github.tool_repository : null;
  const toolRef = typeof github?.tool_ref === 'string' ? github.tool_ref : null;
  const issues: Array<{ file: string; message: string }> = [];
  if (governance?.scope_lock !== 'required') issues.push({ file: 'prototype.config.yaml', message: 'governance.scope_lock 必须为 required。' });
  if (!owner || !toolRepository || !toolRef) issues.push({ file: 'prototype.config.yaml', message: '缺少完整的 governance.github owner/tool_repository/tool_ref。' });
  else {
    if (toolRepository !== `${owner}/ai_axure`) issues.push({ file: 'prototype.config.yaml', message: `tool_repository 必须固定为 ${owner}/ai_axure。` });
    if (!/^v\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?$/.test(toolRef)) issues.push({ file: 'prototype.config.yaml', message: 'tool_ref 必须使用版本 Tag，不能使用分支。' });
    const expectedCodeowners = codeownersContent(owner);
    const expectedWorkflow = workflowContent(owner, toolRef);
    const files: Array<[string, string]> = [['.github/CODEOWNERS', expectedCodeowners], ['.github/workflows/prototype-gate.yml', expectedWorkflow]];
    for (const [file, expected] of files) {
      const full = join(root, file);
      if (!existsSync(full)) issues.push({ file, message: '治理文件缺失。' });
      else if (readFileSync(full, 'utf8').replaceAll('\r\n', '\n') !== expected) issues.push({ file, message: '治理文件与受支持模板不一致，可能已被弱化。' });
    }
  }
  return { status: issues.length === 0 ? 'READY' : owner ? 'STALE' : 'MISSING', enabled, owner, toolRepository, toolRef, issues };
}

export function setupGithubGovernance(root: string, ownerInput: string, toolRefInput: string): GovernanceStatus {
  const owner = normalizeOwner(ownerInput);
  const toolRef = normalizeToolRef(toolRefInput);
  const configPath = join(root, 'prototype.config.yaml');
  const raw = readYaml<Record<string, unknown>>(configPath);
  const desiredGovernance = { scope_lock: 'required', github: { owner, tool_repository: `${owner}/ai_axure`, tool_ref: toolRef } };
  const canonical = (value: unknown): unknown => value && typeof value === 'object' && !Array.isArray(value)
    ? Object.fromEntries(Object.entries(value as Record<string, unknown>).sort(([a], [b]) => a.localeCompare(b)).map(([key, item]) => [key, canonical(item)]))
    : Array.isArray(value) ? value.map(canonical) : value;
  if (raw.governance && JSON.stringify(canonical(raw.governance)) !== JSON.stringify(canonical(desiredGovernance))) {
    throw new ProtoError('prototype.config.yaml 已包含不同的 governance 配置，已拒绝覆盖。请人工合并后重试。');
  }
  const desiredFiles: Array<[string, string]> = [
    ['.github/CODEOWNERS', codeownersContent(owner)],
    ['.github/workflows/prototype-gate.yml', workflowContent(owner, toolRef)],
  ];
  for (const [file, desired] of desiredFiles) {
    const full = join(root, file);
    if (existsSync(full) && readFileSync(full, 'utf8').replaceAll('\r\n', '\n') !== desired) {
      throw new ProtoError(`${file} 已存在自定义内容，已拒绝覆盖。请人工合并以下受支持模板后重试。\n\n${desired}`);
    }
  }
  raw.governance = desiredGovernance;
  writeYaml(configPath, raw);
  mkdirSync(join(root, '.github', 'workflows'), { recursive: true });
  for (const [file, desired] of desiredFiles) writeFileSync(join(root, file), desired, 'utf8');
  const legacyPath = join(root, '.github/workflows/product-lint.yml');
  if (existsSync(legacyPath) && readFileSync(legacyPath, 'utf8').replaceAll('\r\n', '\n') === legacyWorkflow) unlinkSync(legacyPath);
  return governanceStatus(root);
}

export function governanceLintIssue(root: string): { file: string; message: string }[] {
  const status = governanceStatus(root);
  return status.enabled ? status.issues : [];
}
