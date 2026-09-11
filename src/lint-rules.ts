import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { readYaml } from './io.js';
import { listFeatures } from './workspace.js';
import type { LintIssue, ScopeModel } from './types.js';

/**
 * P0-4 新增的确定性 Lint 规则。
 * 与 P0-1（结构/版本）、P0-3（Registry 与实现文件一致性）分开成文件，避免 runLint 继续膨胀。
 *
 * L012：Feature Scope 声明了不存在的页面 / 公共组件 / Product Model
 * L013：合并后两个 Feature 引入的产品语义重复（同一触发条件）或语义冲突（同一触发、不同结果）
 */

/** product/ 下真实存在的 Product Model 文件键（去掉扩展名）。 */
export function knownProductModelKeys(root: string): Set<string> {
  const names = ['product.yaml', 'navigation.yaml', 'routes.yaml', 'terminology.yaml', 'permissions.yaml', 'pages.yaml'];
  return new Set(names.filter((name) => existsSync(join(root, 'product', name))).map((name) => name.replace(/\.ya?ml$/i, '')));
}

export interface ScopeReferenceContext {
  /** 已定义的 page id：navigation 叶子 + Page Registry */
  knownPages: Set<string>;
  /** 已登记的公共组件 id */
  knownComponents: Set<string>;
  /** 真实存在的 Product Model 文件键 */
  knownProductModel: Set<string>;
}

/** 最多列出若干个候选值，避免错误信息被长列表淹没。 */
function sample(values: Iterable<string>, limit = 8): string {
  const sorted = [...values].sort();
  if (sorted.length === 0) return '（当前没有可选项）';
  const head = sorted.slice(0, limit).join('、');
  return sorted.length > limit ? `${head} 等 ${sorted.length} 项` : head;
}

/** L012：Scope 里声明了不存在的对象。确定性规则，允许 BLOCK。 */
export function scopeReferenceIssues(featureId: string, scope: ScopeModel, context: ScopeReferenceContext): LintIssue[] {
  const issues: LintIssue[] = [];
  const file = `features/${featureId}/scope.yaml`;

  scope.allowed.pages.forEach((page, index) => {
    if (context.knownPages.has(page)) return;
    issues.push({
      code: 'L012',
      title: 'Scope Reference Invalid',
      message: `allowed.pages 声明了不存在的页面：${page}`,
      file,
      field: `allowed.pages[${index}]`,
      fix: `改为已定义的 page id（${sample(context.knownPages)}），或先在 product/navigation.yaml 或 product/pages.yaml 中登记该页面。`,
    });
  });

  scope.allowed.shared_components.forEach((component, index) => {
    if (context.knownComponents.has(component)) return;
    issues.push({
      code: 'L012',
      title: 'Scope Reference Invalid',
      message: `allowed.shared_components 声明了未登记的公共组件：${component}`,
      file,
      field: `allowed.shared_components[${index}]`,
      fix: `先在 components/registry.yaml 中登记该组件（${sample(context.knownComponents)}），或删除该授权项。`,
    });
  });

  scope.allowed.product_model.forEach((item, index) => {
    const key = String(item).replace(/\.ya?ml$/i, '');
    if (context.knownProductModel.has(key)) return;
    issues.push({
      code: 'L012',
      title: 'Scope Reference Invalid',
      message: `allowed.product_model 声明了不存在的 Product Model 文件：${item}`,
      file,
      field: `allowed.product_model[${index}]`,
      fix: `改为真实存在的 Product Model（${sample(context.knownProductModel)}），或删除该授权项。`,
    });
  });

  return issues;
}

interface RawScenario {
  id?: unknown;
  given?: unknown;
  when?: unknown;
  then?: unknown;
}

function normalizeText(value: unknown): string {
  return typeof value === 'string' ? value.replace(/\s+/g, ' ').trim().toLowerCase() : '';
}

/**
 * 读取场景表。真实工作区的写法是 `scenarios: [...]`（顶层映射），
 * 也兼容直接写裸数组；两种都不匹配时返回 malformed，由调用方报 L007，
 * 而不是静默跳过——静默跳过会让整条规则在真实数据上失效。
 */
function readScenarioList(path: string): { items: RawScenario[]; malformed: boolean } {
  let raw: unknown;
  try {
    raw = readYaml<unknown>(path);
  } catch {
    return { items: [], malformed: true };
  }
  if (Array.isArray(raw)) return { items: raw as RawScenario[], malformed: false };
  const document = typeof raw === 'object' && raw !== null ? (raw as Record<string, unknown>) : null;
  if (Array.isArray(document?.scenarios)) return { items: document.scenarios as RawScenario[], malformed: false };
  return { items: [], malformed: true };
}

/**
 * L013：跨 Feature 的产品语义重复。
 * 判据是**确定性的**：另一个 Feature 出现了同一 (Given, When)。
 * - Then 相同 → 语义重复；
 * - Then 不同 → 语义冲突（同一触发条件给出两种结果）。
 * 同一 Feature 内部重复不计入（不属于"合并后两个 Feature"的冲突）。
 */
export function crossFeatureSemanticsIssues(root: string): LintIssue[] {
  const issues: LintIssue[] = [];
  const claimed = new Map<string, { feature: string; scenario: string; then: string }>();
  for (const feature of listFeatures(root)) {
    const relative = `features/${feature.id}/scenarios.yaml`;
    const path = join(root, relative);
    if (!existsSync(path)) continue;
    const { items, malformed } = readScenarioList(path);
    if (malformed) {
      issues.push({
        code: 'L007',
        title: 'Schema Violation',
        message: `${relative} 的结构无法识别：应为 scenarios: [...] 列表（或直接写数组）。`,
        file: relative,
        field: 'scenarios',
        fix: '按模板改为 `scenarios:` 下的对象列表，每项包含 id / given / when / then。',
      });
      continue;
    }
    items.forEach((scenario, index) => {
      const given = normalizeText(scenario.given);
      const when = normalizeText(scenario.when);
      if (!given && !when) return;
      const then = normalizeText(scenario.then);
      const key = `${given}\u0000${when}`;
      const label = String(scenario.id ?? index + 1);
      const previous = claimed.get(key);
      if (!previous) {
        claimed.set(key, { feature: feature.id, scenario: label, then });
        return;
      }
      if (previous.feature === feature.id) return;
      const detail = `Given「${String(scenario.given ?? '')}」/ When「${String(scenario.when ?? '')}」`;
      issues.push(previous.then === then
        ? {
          code: 'L013',
          title: 'Cross-Feature Duplicate Semantics',
          message: `Feature ${previous.feature}（场景 ${previous.scenario}）与 ${feature.id}（场景 ${label}）声明了完全相同的语义：${detail}`,
          file: relative,
          field: `scenarios[${index}]`,
          fix: '确认这是同一个产品能力：保留一个 Feature 的场景描述，或让两个 Feature 的场景表达不同能力。',
        }
        : {
          code: 'L013',
          title: 'Cross-Feature Duplicate Semantics',
          message: `Feature ${previous.feature}（场景 ${previous.scenario}）与 ${feature.id}（场景 ${label}）在相同触发条件下给出不同结果：${detail}`,
          file: relative,
          field: `scenarios[${index}]`,
          fix: '对齐两个 Feature 的期望结果，或拆分触发条件使其不再相同。',
        });
    });
  }
  return issues;
}
