import YAML from 'yaml';
import type { ComponentRegistry, PageRegistry } from './registry.js';

/**
 * 可见名解析（Product Diff 可读性 v2）。
 *
 * 背景：V0.1 的 Product Diff 用文件名、page id、capability_key 当主语，PM 读不懂
 * （「对比按钮」被写成 compare-two-versions）。本模块把「工程标识符 → 人读得到的可见名」
 * 变成一条显式的、确定性的解析链：
 *
 *   1. Page Registry（product/pages.yaml）的页面 name
 *   2. product/navigation.yaml 的页面 name（导航里的名字就是用户看到的名字）
 *   3. product/terminology.yaml 的术语 zh_CN
 *   4. 页面 spec / requirement.md / scenarios.yaml 里出现的按钮、字段、区域名
 *   5. 兜底：回退为工程标识（capability_key / page id / 文件名），并标注「未登记可见名」
 *
 * 全程只做字符串解析，不调用 LLM、不访问网络、不依赖执行时间：同样的工作区必然得到同样的可见名。
 * 工程标识没有被丢弃，而是降级进入「工程定位」括号（VisibleRef.location / fallbackOf）。
 */

export type NameSource = 'registry' | 'navigation' | 'terminology' | 'spec' | 'scenario' | 'feature' | 'fallback';

/** 一个可见名的解析结果：可见名 + 来源 + （回退时）被回退的工程标识 + 工程定位。 */
export interface VisibleRef {
  /** 人读得到的名字；回退时为「（未登记可见名，回退为 X）」。 */
  name: string;
  source: NameSource;
  /** 回退时被回退的工程标识（page id / 组件 id / capability_key / 文件路径）；正常解析时为 null。 */
  fallbackOf: string | null;
  /** 工程定位：page id、spec 文件、组件 id、capability_key 等，只允许出现在括号里。 */
  location: string;
}

/** 元素（按钮 / 字段 / 区域）可见名。 */
export interface ElementRef extends VisibleRef {
  /** 元素形态：按钮 / 入口 / 勾选框 / 字段 / 区域 …；无法判定为空串（此时主句不追加后缀）。 */
  kind: string;
}

export interface VisibleNameIndex {
  /** page id → 页面可见名 */
  pages: Record<string, VisibleRef>;
  /** 组件 id → 组件可见名（Component Registry 的 description） */
  components: Record<string, VisibleRef>;
  /** 术语 key → 中文可见名 */
  terms: Record<string, string>;
}

export interface NameResolverInput {
  registry: PageRegistry;
  components: ComponentRegistry;
  /** product/navigation.yaml 的 page id → name */
  navigationNames: Map<string, string>;
  /** product/terminology.yaml 的术语 key → zh_CN */
  terms: Map<string, string>;
  /** 按路径读取文本（缺失返回 null）。 */
  readText: (path: string) => string | null;
}

export interface ElementQuery {
  /** 工程定位：这段文本来自哪个文件 / 哪条能力，写进括号。 */
  locate: string;
  /** 用于判定来源的旁证文本（页面 spec、requirement.md）：命中时 source=spec。 */
  corroborate?: string | null;
  /** 兜底标识：文本里找不到任何按钮 / 字段 / 区域名时回退为它（capability id、文件路径）。 */
  fallbackOf: string;
}

export interface NameResolver {
  page(id: string | null, files?: string[]): VisibleRef;
  component(id: string): VisibleRef;
  feature(id: string, name: string): VisibleRef;
  element(text: string, query: ElementQuery): ElementRef;
  /** 页面的可见文本（Page Registry 的 spec，或 specs/<id>.md）：用于来源判定与多页消歧。 */
  pageText(id: string): string;
  index(): VisibleNameIndex;
}

/** 未登记可见名时的统一标注文案（测试与证据文档都依赖这个前缀）。 */
export const UNREGISTERED = '（未登记可见名，回退为';

function unregistered(token: string, location: string): VisibleRef {
  return { name: `${UNREGISTERED} ${token}）`, source: 'fallback', fallbackOf: token, location };
}

function distinct(value: string | null | undefined, id: string): string | null {
  return value && value.trim() && value.trim() !== id ? value.trim() : null;
}

// ---------------------------------------------------------------------------
// 元素名抽取：只认「控件名词」上下文的字符串，避免把业务词当点击对象
// ---------------------------------------------------------------------------

const CLICK_VERBS = ['点击', '单击', '按下', '点按', '选中', '点开'];
const CONTROL_NOUNS = ['按钮', '入口', '勾选框', '选择框', '复选框', '输入框', '下拉框', '开关', '链接', '页签', '菜单', '图标', '字段', '表单项'];
const REGION_NOUNS = ['抽屉', '弹窗', '对话框', '面板', '区域', '结果区', '详情区', '列表'];

/**
 * 组件类型词（前端控件英文名）：它们是「区域类型」，不是名字本体。
 *
 * 用户原话是「大量疑似前端控件英文名之类的东西，我完全不知道这是一个什么东西」——
 * `Drawer` / `Modal` 对 PM 就是这个东西。因此抽到 `版本历史 Drawer` 时必须裁成「版本历史」，
 * 类型信息改由中文 `kind`（区域）承载：主句输出 `『版本历史』区域`，既不丢类型，也不留英文类型词。
 */
const TYPE_SUFFIXES = ['Drawer', 'Modal', 'Dialog', 'Popover', 'Dropdown', 'Table', 'Tab', 'Tooltip', 'Card'];

/** 区域识别用的名词 = 中文区域名词 + 组件类型词（后者只用于识别，不允许进入名字）。 */
const ALL_REGION_NOUNS = [...REGION_NOUNS, ...TYPE_SUFFIXES];

/** 剔除紧贴在控件名前的动词 / 虚词，把「用户查看版本条目的字段」收敛成「版本条目」。 */
const STRIP_PREFIXES = [
  '用户', '评审人', '产品经理', '该', '此', '其', '各', '任何', '所有', '以及', '并且', '并', '再', '重新', '继续',
  '可以', '能够', '需要', '应该', '在', '对', '把', '将', '从', '到', '为', '是', '有', '无', '不', '未', '已',
  '当', '若', '则', '后', '前', '时', '内', '外', '上', '下', '个', '和', '与', '及', '的', '了', '等',
];
const STRIP_VERBS = ['点击', '单击', '按下', '查看', '看到', '关闭', '打开', '展示', '显示', '进入', '选择', '勾选', '取消', '切换', '新增', '删除', '确认', '保存', '提交', '完成', '使用', '指定', '发现', '存在', '提供'];

const STRIP_ORDER = [...STRIP_PREFIXES, ...STRIP_VERBS].sort((a, b) => b.length - a.length);

function byLengthDesc(values: string[]): string[] {
  return [...values].sort((a, b) => b.length - a.length);
}

const CONTROL_BY_LENGTH = byLengthDesc(CONTROL_NOUNS);
const REGION_BY_LENGTH = byLengthDesc(ALL_REGION_NOUNS);
const CLICK_BY_LENGTH = byLengthDesc(CLICK_VERBS);

/** 无引号抽取的噪声护栏：把「比结果按固定字段」这类句子碎片挡掉。 */
const TOKEN_JUNK = /[，。、；：！？（）【】由从为的了和与或并且是在对把将后前时内外上下该此其各按取用做看开关查变改]|给出|输出|展示|显示|取值|结果|相关|以下|上述|任何|所有|提供|支持/;

/** 无引号抽取只接受中文可见名：纯 ASCII 的 token 是工程名（DataTable / versionList），不进主句。 */
function isVisibleToken(token: string): boolean {
  return token.length >= 2 && token.length <= 8 && /[\u4e00-\u9fa5]/.test(token) && !TOKEN_JUNK.test(token);
}

/**
 * 裁掉结尾的组件类型词：`版本历史 Drawer` → `版本历史`。
 * 类型词前必须有非 ASCII 字母数字的分隔（空格 / 中文），避免把 `discard` 裁成 `dis`、把 `DataTable` 裁成 `Data`。
 * 裁完为空（名字本身就是 `Drawer`）时原样返回：不猜、不产生半截名字。
 */
function stripTypeSuffix(name: string): { name: string; typeWord: string | null } {
  for (const type of TYPE_SUFFIXES) {
    const trimmed = name.replace(new RegExp(`[\\s　]*(?<![A-Za-z0-9_])${type}$`), '').trim();
    if (trimmed === name.trim()) continue;
    return trimmed ? { name: trimmed, typeWord: type } : { name, typeWord: null };
  }
  return { name, typeWord: null };
}

/**
 * 名字定稿的**唯一入口**：路径式名字取最后一段 + 类型词裁剪。
 *
 * 所有抽取路径（引号名、无引号控件名、无引号区域名）都必须经过这里 ——
 * 这样 `+ 新增 / ~ 修改 / - 删除`（CAPABILITIES 段）与替换条目（REQUIREMENT REPLACEMENTS 段）
 * 共用同一份裁剪结果，不可能出现「一段修了、另一段没修」的半修状态：
 * 渲染侧也只有 `changeSentence()` 一处（见 diff.ts 的 elementPhrase）。
 */
function finalizeName(raw: string): { name: string; typeWord: string | null } {
  return stripTypeSuffix(lastSegment(raw));
}

function trimToken(token: string): string {
  let value = token;
  for (let guard = 0; guard < 8; guard += 1) {
    const before = value;
    value = value.replace(/[的了个等]+$/, '');
    for (const prefix of STRIP_ORDER) {
      if (value.length > prefix.length && value.startsWith(prefix)) {
        value = value.slice(prefix.length);
        break;
      }
    }
    if (value === before) break;
  }
  return value.trim();
}

/** 引号内的名字：CJK 引号成对，双引号单独处理。 */
function scanQuoted(text: string): Array<{ name: string; start: number; end: number }> {
  const openers = '“「『';
  const closers = '”」』';
  const result: Array<{ name: string; start: number; end: number }> = [];
  for (let index = 0; index < text.length; index += 1) {
    const char = text[index] as string;
    const slot = openers.indexOf(char);
    const close: string | null = slot >= 0 ? closers[slot] ?? null : char === '"' ? '"' : null;
    if (close === null) continue;
    const end = text.indexOf(close, index + 1);
    if (end < 0 || end - index > 32) continue;
    const name = text.slice(index + 1, end).trim();
    if (name) result.push({ name, start: index, end: end + 1 });
    index = end;
  }
  return result;
}

/** 「归因规则 → 查看历史版本」这类路径式名字只取最后一段，避免主句里出现导航路径。 */
function lastSegment(name: string): string {
  for (const separator of ['→', '->', '>', '/']) {
    if (!name.includes(separator)) continue;
    const parts = name.split(separator).map((part) => part.trim()).filter(Boolean);
    if (parts.length > 1) return parts[parts.length - 1] as string;
  }
  return name;
}

function nounAt(after: string, nouns: string[]): string | null {
  const trimmed = after.replace(/^[\s　]+/, '');
  for (const noun of nouns) if (trimmed.startsWith(noun)) return noun;
  return null;
}

/** 句末标点：点击动词必须与被点名的控件在同一个句子里，避免跨句误判。 */
const HARD_STOPS = ['。', '；', ';', '！', '!', '？', '?', '\n'];

/** 引号名前（同一句内）是否出现点击动词：`点击某个历史版本的“与当前版本对比”`。 */
function verbBefore(text: string, start: number): boolean {
  const window = text.slice(Math.max(0, start - 24), start);
  const stop = Math.max(...HARD_STOPS.map((mark) => window.lastIndexOf(mark)));
  const tail = window.slice(stop + 1);
  return CLICK_BY_LENGTH.some((verb) => tail.includes(verb));
}

interface Candidate {
  name: string;
  kind: string;
  tier: number;
  at: number;
}

/**
 * 从一段文本里抽出「用户点击 / 看到的那个控件」。
 * tier 越小越可信：点击动词 + 引号名 > 引号名 + 控件名词 > 无引号 + 控件名词 > 区域名。
 */
export function extractCandidate(text: string): Candidate | null {
  const candidates: Candidate[] = [];
  for (const quoted of scanQuoted(text)) {
    const after = text.slice(quoted.end, quoted.end + 8);
    const stripped = finalizeName(quoted.name);
    const name = stripped.name;
    // 引号里自带类型词（“版本历史 Drawer”）时，类型由中文 kind 承载，不再写成按钮。
    const typeKind = stripped.typeWord ? '区域' : null;
    if (verbBefore(text, quoted.start)) {
      candidates.push({ name, kind: typeKind ?? '按钮', tier: 0, at: quoted.start });
      continue;
    }
    const control = nounAt(after, CONTROL_BY_LENGTH);
    if (control) {
      candidates.push({ name, kind: typeKind ?? control, tier: 1, at: quoted.start });
      continue;
    }
    if (nounAt(after, REGION_BY_LENGTH)) candidates.push({ name, kind: '区域', tier: 2, at: quoted.start });
  }
  const controlPattern = new RegExp(`([\\u4e00-\\u9fa5A-Za-z0-9_]{2,12})(${CONTROL_BY_LENGTH.join('|')})`, 'g');
  for (const match of text.matchAll(controlPattern)) {
    const token = trimToken(match[1] ?? '');
    if (!isVisibleToken(token)) continue;
    candidates.push({ name: finalizeName(token).name, kind: match[2] as string, tier: 3, at: match.index ?? 0 });
  }
  const regionPattern = new RegExp(`([\\u4e00-\\u9fa5A-Za-z0-9_]{2,14})[\\s　]?(${REGION_BY_LENGTH.join('|')})`, 'g');
  for (const match of text.matchAll(regionPattern)) {
    const token = trimToken(match[1] ?? '');
    if (!isVisibleToken(token)) continue;
    const noun = match[2] as string;
    // 组件类型词不拼进名字：`版本历史 Drawer` → 名字「版本历史」，类型由 kind='区域' 承载；
    // 中文区域名词仍然是名字的一部分（`版本历史列表` 就是一个整体名字）。
    const raw = TYPE_SUFFIXES.includes(noun) ? token : `${token}${noun}`;
    candidates.push({ name: finalizeName(raw).name, kind: '区域', tier: 4, at: match.index ?? 0 });
  }
  if (candidates.length === 0) return null;
  return candidates.sort((a, b) => a.tier - b.tier || a.at - b.at)[0] ?? null;
}

// ---------------------------------------------------------------------------
// Resolver
// ---------------------------------------------------------------------------

export function createNameResolver(input: NameResolverInput): NameResolver {
  const { registry, components, navigationNames, terms } = input;
  const pageCache = new Map<string, string>();

  const termOf = (key: string): string | null => terms.get(key) ?? null;

  const pageText = (id: string): string => {
    const cached = pageCache.get(id);
    if (cached !== undefined) return cached;
    const spec = registry.entries.get(id)?.spec ?? null;
    const candidates = [...new Set([spec, `specs/${id}.md`].filter((value): value is string => Boolean(value)))];
    const text = candidates.map((path) => input.readText(path) ?? '').filter(Boolean).join('\n');
    pageCache.set(id, text);
    return text;
  };

  const page = (id: string | null, files: string[] = []): VisibleRef => {
    if (!id) {
      const token = files[0] ?? 'unknown-page';
      return unregistered(token, token);
    }
    const entry = registry.entries.get(id);
    const registered = distinct(entry?.name, id);
    if (registered) {
      return { name: registered, source: 'registry', fallbackOf: null, location: `page ${id}（product/pages.yaml）` };
    }
    const navigated = distinct(navigationNames.get(id), id);
    if (navigated) {
      return { name: navigated, source: 'navigation', fallbackOf: null, location: `page ${id}（product/navigation.yaml）` };
    }
    const term = distinct(termOf(id), id);
    if (term) {
      return { name: term, source: 'terminology', fallbackOf: null, location: `page ${id}（product/terminology.yaml）` };
    }
    return unregistered(id, `page ${id}`);
  };

  const component = (id: string): VisibleRef => {
    const entry = components.entries.get(id);
    const description = distinct(entry?.description, id);
    if (description) {
      const key = entry?.capabilityKey ? `；capability_key ${entry.capabilityKey}` : '';
      return { name: description, source: 'registry', fallbackOf: null, location: `组件 ${id}（components/registry.yaml${key}）` };
    }
    const term = distinct(termOf(id), id);
    if (term) return { name: term, source: 'terminology', fallbackOf: null, location: `组件 ${id}（product/terminology.yaml）` };
    return unregistered(id, `组件 ${id}`);
  };

  const feature = (id: string, name: string): VisibleRef => {
    const visible = distinct(name, id);
    if (visible) return { name: visible, source: 'feature', fallbackOf: null, location: `feature ${id}（features/${id}/scope.yaml）` };
    return unregistered(id, `feature ${id}`);
  };

  const element = (text: string, query: ElementQuery): ElementRef => {
    const candidate = extractCandidate(text);
    if (!candidate) {
      const ref = unregistered(query.fallbackOf, query.locate);
      return { ...ref, kind: '' };
    }
    const term = distinct(termOf(candidate.name), candidate.name);
    if (term) return { name: term, source: 'terminology', fallbackOf: null, location: query.locate, kind: candidate.kind };
    const corroborated = (query.corroborate ?? '').includes(candidate.name);
    return {
      name: candidate.name,
      source: corroborated ? 'spec' : 'scenario',
      fallbackOf: null,
      location: query.locate,
      kind: candidate.kind,
    };
  };

  return {
    page,
    component,
    feature,
    element,
    pageText,
    index: () => ({
      pages: Object.fromEntries([...new Set([...registry.entries.keys(), ...navigationNames.keys()])].sort().map((id) => [id, page(id)])),
      components: Object.fromEntries([...components.entries.keys()].sort().map((id) => [id, component(id)])),
      terms: Object.fromEntries([...terms.entries()].sort((a, b) => (a[0] < b[0] ? -1 : 1))),
    }),
  };
}

/** 术语表解析：`terms: { key: { zh_CN: 名 } }`（也兼容 `terms: { key: 名 }`）。 */
export function parseTerminology(text: string | null): Map<string, string> {
  const terms = new Map<string, string>();
  if (!text || !text.trim()) return terms;
  let document: unknown;
  try {
    document = YAML.parse(text);
  } catch {
    return terms;
  }
  const record = asRecord(document);
  const list = record ? asRecord(record.terms) : null;
  if (!list) return terms;
  for (const [key, value] of Object.entries(list)) {
    if (typeof value === 'string' && value.trim()) {
      terms.set(key, value.trim());
      continue;
    }
    const entry = asRecord(value);
    const zh = entry ? entry.zh_CN ?? entry.zh ?? entry.name : null;
    if (typeof zh === 'string' && zh.trim()) terms.set(key, zh.trim());
  }
  return terms;
}

function asRecord(value: unknown): Record<string, unknown> | null {
  return typeof value === 'object' && value !== null && !Array.isArray(value) ? (value as Record<string, unknown>) : null;
}
