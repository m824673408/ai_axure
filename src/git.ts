import { execFileSync, spawnSync } from 'node:child_process';
import { existsSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { ProtoError } from './errors.js';
import { normalizePath } from './io.js';
import type { ChangedFile } from './types.js';

export function git(root: string, args: string[], allowFailure = false): string {
  const result = spawnSync('git', args, { cwd: root, encoding: 'utf8' });
  if (result.status !== 0 && !allowFailure) {
    const detail = (result.stderr || result.stdout || '').trim();
    throw new ProtoError(`Git 命令失败：git ${args.join(' ')}${detail ? `\n${detail}` : ''}`);
  }
  return (result.stdout || '').trim();
}

export function isGitRepository(root: string): boolean {
  if (existsSync(join(root, '.git'))) return true;
  return git(root, ['rev-parse', '--is-inside-work-tree'], true) === 'true';
}

export function currentBranch(root: string): string {
  return git(root, ['branch', '--show-current']);
}

export function ensureClean(root: string): void {
  if (git(root, ['status', '--porcelain'])) throw new ProtoError('Git Working Tree 必须保持干净。');
}

export function currentFeature(root: string): string | null {
  const branch = currentBranch(root);
  return branch.startsWith('feature/') ? branch.slice('feature/'.length) : null;
}

function parseNameStatus(output: string): ChangedFile[] {
  if (!output.trim()) return [];
  return output.split(/\r?\n/).filter(Boolean).map((line) => {
    const parts = line.split('\t');
    const rawStatus = parts[0] ?? 'M';
    const path = rawStatus.startsWith('R') ? parts[2] : parts[1];
    return {
      status: (rawStatus[0] === '?' ? 'U' : rawStatus[0]) as ChangedFile['status'],
      path: normalizePath(path ?? ''),
    };
  });
}

export function changedFiles(root: string, baseBranch: string): ChangedFile[] {
  const branch = currentBranch(root);
  if (branch === baseBranch) return [];
  const mergeBase = git(root, ['merge-base', baseBranch, 'HEAD'], true) || baseBranch;
  const tracked = parseNameStatus(git(root, ['diff', '--name-status', mergeBase]));
  const untracked = git(root, ['ls-files', '--others', '--exclude-standard'], true)
    .split(/\r?\n/)
    .filter(Boolean)
    .map((path) => ({ path: normalizePath(path), status: 'U' as const }));
  const map = new Map<string, ChangedFile>();
  for (const file of [...tracked, ...untracked]) map.set(file.path, file);
  return [...map.values()].sort((a, b) => a.path.localeCompare(b.path));
}

export function fullDiff(root: string, baseBranch: string): string {
  const branch = currentBranch(root);
  if (branch === baseBranch) return '';
  const mergeBase = git(root, ['merge-base', baseBranch, 'HEAD'], true) || baseBranch;
  const tracked = git(root, ['diff', '--no-ext-diff', '--unified=3', mergeBase], true);
  const additions: string[] = [];
  for (const file of changedFiles(root, baseBranch).filter((item) => item.status === 'U')) {
    const full = join(root, file.path);
    if (!existsSync(full) || statSync(full).size > 200_000) {
      additions.push(`diff --git a/${file.path} b/${file.path}\nnew file omitted from prompt (missing or larger than 200 KB)`);
      continue;
    }
    const source = readFileSync(full, 'utf8');
    const body = source.split(/\r?\n/).map((line) => `+${line}`).join('\n');
    additions.push(`diff --git a/${file.path} b/${file.path}\nnew file mode 100644\n--- /dev/null\n+++ b/${file.path}\n${body}`);
  }
  return [tracked, ...additions].filter(Boolean).join('\n');
}

export function commandExists(command: string): boolean {
  try {
    execFileSync(process.platform === 'win32' ? 'where.exe' : 'which', [command], { stdio: 'ignore' });
    return true;
  } catch {
    return false;
  }
}
