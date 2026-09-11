# Gate E 客观成本事实（PM 成本）

> 本文件只记录**可核对的事实**，不估算、不捏造人工耗时。
> 协调 Agent 整理；**最终结论必须由用户本人给出**（见第 4 节）。
> 日期：2026-09-11

## 1. 三个需求的完整流程事实

`REQ-GATE-001 归因结果组合筛选`、`REQ-GATE-002 联调白名单`、`REQ-GATE-003 媒体配置状态筛选` 三个需求均完成了同一套完整流程后才合并：Feature 规范 → Scope → Lint → Diff → 实现 → 构建 → 浏览器验收 → 合并。

可核对依据：

```text
e4c1d88 merge: REQ-GATE-003
ad1a2f8 feat: add media configuration filters
12eab7f merge: REQ-GATE-002
8f7ad29 feat: add device whitelist
0be97b8 merge: REQ-GATE-001
d5aadeb feat: add attribution result filters
```

- 三次需求各自的 Lint 记录：`gate-a-req-001-final-lint.txt`、`gate-a-req-002-lint.txt`、`gate-a-req-003-lint.txt`（三者均 `Result: PASS`，且后两者额外包含 `✓ Feature scope` 项）。
- 三次需求各自的 Diff 记录：`gate-a-req-001-final-diff.txt`、`gate-a-req-002-diff.txt`、`gate-a-req-003-diff.txt`。
- 最终整体 Lint 记录：`gate-a-final-lint.txt`（`Result: PASS`）。
- 最终结构检查：`gate-a-structural.txt`（`navigation_pages=6`、`route_keys=6`、`navigation_without_route=0`、`duplicate_route_paths=0`、`page_level_antd_layout_imports=0`、`global_style_changed=False`、`working_tree_clean=True`）。

## 2. 流程产生的实际摩擦（可核对）

### 2.1 REQ-GATE-001 首次 Scope 只写页面 ID，触发 L001

首次提交时 Scope 只写了页面 ID，未显式给出 CamelCase 页面文件路径，Lint 命中 `L001`：

```text
PRODUCT LINT

FAIL
✗ L001 Scope Violation
File: prototype/src/pages/AttributionResultsPage.tsx
当前 Feature Scope 未授权修改：prototype/src/pages/AttributionResultsPage.tsx

Result: BLOCKED
```

依据：`gate-a-req-001-lint.txt`（失败）与 `gate-a-req-001-final-lint.txt`（补齐显式路径后 `Result: PASS`）。

**性质：实际工作流摩擦（摩擦点：页面 ID → 文件路径之间需要人工补全显式路径）。**

### 2.2 REQ-GATE-001 的 Semantic Diff 发现了真实缺陷

`gate-a-req-001-final-semantic.md` 明确记录：时间范围需“按**自然日**计算，**包含开始日与结束日**（整日闭区间）”；设备标识需“使用**不区分大小写的包含匹配**，匹配对象为**完整设备标识**，非脱敏展示值”，且“表格中仍展示**脱敏值**，不因筛选改变展示口径”。

这两条澄清对应交接文档所记的事实：原实现存在“日期选择存在但没有真正过滤”，以及设备标识展示/匹配语义需要澄清，因此发生了修正循环。

**性质：流程产生的实际价值（问题在合并前被产品语义层发现并修正）。**

### 2.3 REQ-GATE-002 的 Semantic Diff 需要一次明确外发授权

`REQ-GATE-002` 的 Semantic Diff 需要一次明确的外部 LLM 数据发送授权（用户已就该需求授权一次）。其输出记录于 `gate-a-req-002-semantic.md`，内容为 Product Diff / 交互 / 产品规则 / Product Model / Shared Component / 风险六段，**未出现阻断项**（列出的均为风险与未定义项）。

**性质：流程产生的额外协调成本（一次显式授权往返）。**

### 2.4 REQ-GATE-003 未执行 Semantic Diff

没有把 `REQ-GATE-002` 的外发授权扩大到新需求，因此 `REQ-GATE-003` 未执行 Semantic Diff；其 Lint（`gate-a-req-003-lint.txt`，PASS）、确定性 Diff（`gate-a-req-003-diff.txt`，Product Model 0 / Shared Components 0 / 变更 5 个文件）、构建与浏览器检查均已完成。

**性质：授权边界造成的流程覆盖差异（同一套流程内，不同需求的检查强度不一致）。**

## 3. 已记录的技术债与工程观察项

### 3.1 基线技术债：Ant Design v5 + React 19 兼容性警告

所有页面存在 Ant Design v5 对 React 19 的兼容性警告，该警告在 Feature 前后均存在，**不能计为本次回归**。

> 测量边界：该结论来自前一执行阶段的桌面浏览器检查记录。本轮（Gate C/D/E/A 收尾）未重新测量——本会话模型不支持图片输入，且本轮未重新运行浏览器检查，故此处仅**转述**已有事实，并将其列为基线技术债。

### 3.2 工程观察项：构建大 chunk 警告

生产构建存在超过 1000 kB 的大 chunk 警告。依据交接文档记录，该警告**不是当前 Gate 定义中的阻断条件**。

> 测量边界：与 3.1 相同，本轮未重新测量，属转述的既有事实。

## 4. 用户已作出的流程决策（事实）

- 本轮不需要真实 backlog。
- LLM 调用改为配置文件形式（`.proto.llm.yaml`，已被忽略）。
- 本轮跳过移动端验证（用户确认的范围）。
- 就 `REQ-GATE-002` 的 Semantic Diff 作出过一次明确外发授权，且未扩大解释到其他 Feature。

## 5. 未测量的项目（明确标注，不补猜测值）

- **用户主动操作时长：未测量。** 现有材料没有任何用户侧的计时记录，任何具体分钟数都会是编造。
- 用户在本轮阅读截图 / 判断视觉一致性的耗时：未测量。
- 三个需求的实现阶段 AI 侧 token 消耗与墙钟耗时：未测量（当前环境无可核对的计量数据）。

## 6. 与本轮平台环境相关的一次摩擦（不计入 Spec/Scope/Diff 流程成本）

本轮收尾时发现一个与流程设计无关、但与“维护这套东西累不累”的体感有关的环境问题，如实记录：

- Gate 工作区所在子树 `output\` 在 DSH Windows ACL 沙箱的 `workspace-write` 模式下**缺少会话写入 SID 的 ACE**（根目录与 `node_modules` 有，`output\`、`src\`、`tests\` 没有），导致受限子进程在其中创建目录、写入文件一律被拒（`UnauthorizedAccessException`）。
- 具体表现：`git clone --local` 到 `output\gate-validation\fresh-context-workspace` 失败（`could not create work tree dir ... Permission denied`）。
- 处理：经用户批准以更宽模式创建副本，并为该副本补上继承写权限 ACE，使受限子进程可在副本内正常执行 `proto` / `npm run build`。
- 该摩擦属**平台工具链**问题（沙箱 ACL 未覆盖已存在的子目录），不是 Spec / Scope / Diff / 验收材料流程本身的开销。

## 7. 需要用户回答的唯一问题

基于这次实际过程，你认为维护 Spec、Scope、Diff 和验收材料是否没有比直接画原型更累？请按“可以接受 / 明显更累”回答，并可补一句最费力的环节。
