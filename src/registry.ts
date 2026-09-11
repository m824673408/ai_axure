import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { normalizePath, pathKey, readYaml } from './io.js';

/**
 * Page / Component Registry（P0-3）。
 *
 * 目的：把「page_id → spec → 实现文件 → route → 模块 → Layout」以及
 * 「组件 id → 能力键 capability_key」变成显式、可校验、可被 Scope/Lint/Diff 共用的数据，
 * 从而消除 V0.1 中「page id 拼不出真实文件名」的摩擦（见 P0-2 背景）。
 *
 * 兼容性：两个 Registry 都是**可选**产物。文件不存在时 present=false，
 * 既有 V0.1 工作区行为完全不变（沿用基于 page id 的文件名推导）。
 */

export interface PageRegistryEntry {
  id: string;
  name: string;
  file: string;
  route: string;
  module: string;
  spec: string | null;
  layout: string | null;
}

export interface ComponentRegistryEntry {
  id: string;
  description: string | null;
  type: string | null;
  capabilityKey: string | null;
}

export interface PageRegistry {
  present: boolean;
  entries: Map<string, PageRegistryEntry>;
  /** 实现文件（normalizePath 后）→ page id */
  fileToPage: Map<string, string>;
}

export interface ComponentRegistry {
  present: boolean;
  entries: Map<string, ComponentRegistryEntry>;
  /** capability_key → 声明该能力的组件 id（按 id 排序） */
  capabilityOwners: Map<string, string[]>;
}

function asRecord(value: unknown): Record<string, unknown> | null {
  return typeof value === 'object' && value !== null && !Array.isArray(value) ? (value as Record<string, unknown>) : null;
}

function asText(value: unknown): string | null {
  return typeof value === 'string' && value.trim() !== '' ? value : null;
}

export const PAGE_REGISTRY_FILE = 'product/pages.yaml';
export const COMPONENT_REGISTRY_FILE = 'components/registry.yaml';

/** 读取 Page Registry；文件缺失或结构非法时返回 present=false / 空表，由 lint 负责报告结构错误。 */
export function loadPageRegistry(root: string): PageRegistry {
  const registry: PageRegistry = { present: false, entries: new Map(), fileToPage: new Map() };
  const path = join(root, PAGE_REGISTRY_FILE);
  if (!existsSync(path)) return registry;
  registry.present = true;
  let raw: unknown;
  try {
    raw = readYaml<unknown>(path);
  } catch {
    return registry;
  }
  const document = asRecord(raw);
  const pages = document ? asRecord(document.pages) : null;
  if (!pages) return registry;
  for (const [id, value] of Object.entries(pages)) {
    const entry = asRecord(value);
    if (!entry) continue;
    const file = asText(entry.file);
    if (!file) continue;
    const normalizedFile = normalizePath(file);
    registry.entries.set(id, {
      id,
      name: asText(entry.name) ?? id,
      file: normalizedFile,
      route: asText(entry.route) ?? id,
      module: asText(entry.module) ?? '',
      spec: asText(entry.spec) ? normalizePath(asText(entry.spec) as string) : null,
      layout: asText(entry.layout),
    });
    if (!registry.fileToPage.has(pathKey(normalizedFile))) registry.fileToPage.set(pathKey(normalizedFile), id);
  }
  return registry;
}

/** 读取 Component Registry 并建立 capability_key → 组件 索引。 */
export function loadComponentRegistry(root: string): ComponentRegistry {
  const registry: ComponentRegistry = { present: false, entries: new Map(), capabilityOwners: new Map() };
  const path = join(root, COMPONENT_REGISTRY_FILE);
  if (!existsSync(path)) return registry;
  registry.present = true;
  let raw: unknown;
  try {
    raw = readYaml<unknown>(path);
  } catch {
    return registry;
  }
  const document = asRecord(raw);
  const components = document ? asRecord(document.components) : null;
  if (!components) return registry;
  for (const [id, value] of Object.entries(components)) {
    const entry = asRecord(value);
    if (!entry) continue;
    const capabilityKey = asText(entry.capability_key);
    registry.entries.set(id, {
      id,
      description: asText(entry.description) ?? asText(entry.purpose),
      type: asText(entry.type),
      capabilityKey,
    });
    if (capabilityKey) {
      const owners = registry.capabilityOwners.get(capabilityKey) ?? [];
      owners.push(id);
      registry.capabilityOwners.set(capabilityKey, owners);
    }
  }
  for (const owners of registry.capabilityOwners.values()) owners.sort();
  return registry;
}

/** 某个 page id 在 Registry 中登记的产物路径（实现文件 + spec），未登记时返回空数组。 */
export function registeredPathsForPage(registry: PageRegistry, pageId: string): string[] {
  const entry = registry.entries.get(pageId);
  if (!entry) return [];
  return [entry.file, entry.spec].filter((value): value is string => Boolean(value));
}

/** 某个实现文件所属的 page id；未登记时返回 null。 */
export function pageIdForFile(registry: PageRegistry, path: string): string | null {
  return registry.fileToPage.get(pathKey(path)) ?? null;
}

/** 声明了同一 capability_key 的组件（只返回重复的键）。 */
export function duplicateCapabilityKeys(registry: ComponentRegistry): Array<{ capabilityKey: string; owners: string[] }> {
  return [...registry.capabilityOwners.entries()]
    .filter(([, owners]) => owners.length > 1)
    .map(([capabilityKey, owners]) => ({ capabilityKey, owners }))
    .sort((a, b) => a.capabilityKey.localeCompare(b.capabilityKey));
}
