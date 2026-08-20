import { existsSync, readFileSync, readdirSync, statSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import YAML from 'yaml';
import { ProtoError } from './errors.js';

export function normalizePath(value: string): string {
  return value.replaceAll('\\', '/').replace(/^\.\//, '');
}

export function readYaml<T>(path: string): T {
  if (!existsSync(path)) throw new ProtoError(`缺少文件：${path}`);
  try {
    return YAML.parse(readFileSync(path, 'utf8')) as T;
  } catch (error) {
    throw new ProtoError(`YAML 解析失败：${path}\n${String(error)}`);
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
