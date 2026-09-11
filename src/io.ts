import { existsSync, readFileSync, readdirSync, statSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import YAML from 'yaml';
import { ProtoError } from './errors.js';

export function normalizePath(value: string): string {
  return value.replaceAll('\\', '/').replace(/^\.\//, '');
}

/**
 * 路径比较键：在 normalizePath 基础上，于大小写不敏感的平台（Windows / macOS 默认）折叠大小写。
 * 用于「路径相等」判定（例如 Registry 的 file→page 反查）。
 * 若不做折叠，Windows 上 Registry 写错大小写会导致查找失败，合法改动被误判为越权（L001）。
 */
export function pathKey(value: string): string {
  const normalized = normalizePath(value);
  return process.platform === 'win32' || process.platform === 'darwin' ? normalized.toLowerCase() : normalized;
}

export function readYaml<T>(path: string): T {
  if (!existsSync(path)) throw new ProtoError(`缺少文件：${path}`);
  try {
    return YAML.parse(readFileSync(path, 'utf8')) as T;
  } catch (error) {
    throw new ProtoError(`YAML 解析失败：${path}\n${String(error)}`);
  }
}

/** Write only structured data. Studio deliberately never accepts a user supplied path. */
export function writeYaml(path: string, value: unknown): void {
  try {
    writeFileSync(path, YAML.stringify(value, { lineWidth: 0 }), 'utf8');
  } catch (error) {
    throw new ProtoError(`YAML 写入失败：${path}\n${String(error)}`);
  }
}

export function findWorkspace(start = process.cwd()): string {
  let current = resolve(start);
  while (true) {
    if (existsSync(join(current, 'prototype.config.yaml'))) return current;
    const parent = dirname(current);
    if (parent === current) break;
    current = parent;
  }
  throw new ProtoError('当前目录不在 Prototype Workspace 中，未找到 prototype.config.yaml。');
}

export function isDirectoryEmpty(path: string): boolean {
  return !existsSync(path) || readdirSync(path).length === 0;
}

export function listFilesRecursive(root: string): string[] {
  if (!existsSync(root)) return [];
  const files: string[] = [];
  for (const entry of readdirSync(root)) {
    const full = join(root, entry);
    if (statSync(full).isDirectory()) files.push(...listFilesRecursive(full));
    else files.push(full);
  }
  return files;
}
