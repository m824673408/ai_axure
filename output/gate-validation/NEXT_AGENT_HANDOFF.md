# Prototype Workspace Gate A–E 后续执行交接

> 用途：交给新的执行 Agent，继续完成尚未结束的 Gate 验收。
>
> 当前日期：2026-09-11；工作环境：Windows / PowerShell；根目录：`E:\AIProject\AI原型工具`。

## 1. 任务边界和用户已确认事项

- 用户要求对已经开发完成的 Prototype Workspace 执行 Gate A–E 验收，并要求所有结论都给出事实依据。
- 需要用户主观判断的项目，必须把问题交还用户，不得代替用户下结论。
- 用户已确认本轮不需要处理或验证移动端。
- 用户已为 `REQ-GATE-002` 的 Semantic Diff 明确授权过一次 LLM 外发；该授权不要扩大解释为其他 Feature 或后续代码也可外发。
- `.proto.llm.yaml` 含真实 LLM 配置，已被忽略。不要打印、复制进证据包、提交 Git 或在回复中披露其中内容。
- 不要改动已经完成的三个 Feature；后续只做测试、隔离副本中的 Fresh Context 需求和验收材料。
- 不要推送远端。

## 2. 目录地图

| 用途 | 绝对路径 |
| --- | --- |
| 工具源码根目录 | `E:\AIProject\AI原型工具` |
| Gate 主工作区（独立嵌套 Git 仓库） | `E:\AIProject\AI原型工具\output\gate-validation\workspace` |
| Gate 证据目录 | `E:\AIProject\AI原型工具\output\gate-validation\evidence` |
| Playwright 截图目录 | `E:\AIProject\AI原型工具\output\playwright\gate-validation` |
| Product Model 越界负例副本 | `E:\AIProject\AI原型工具\output\gate-validation\negative-product` |
| 页面 Scope 越界负例副本 | `E:\AIProject\AI原型工具\output\gate-validation\negative-page` |
| Gate C 盲测包 | `E:\AIProject\AI原型工具\output\gate-validation\evidence\gate-c-package` |
| 待创建的 Fresh Context 副本 | `E:\AIProject\AI原型工具\output\gate-validation\fresh-context-workspace` |

## 3. 当前状态

### Gate A：自动化部分已通过，等待用户视觉判断

已连续完成并合并三个需求：

1. `REQ-GATE-001 归因结果组合筛选`
2. `REQ-GATE-002 联调白名单`
3. `REQ-GATE-003 媒体配置状态筛选`

主工作区当前位于 `main`，工作树干净，最近提交：

```text
e4c1d88 merge: REQ-GATE-003
ad1a2f8 feat: add media configuration filters
12eab7f merge: REQ-GATE-002
8f7ad29 feat: add device whitelist
0be97b8 merge: REQ-GATE-001
d5aadeb feat: add attribution result filters
```

最后一次结构检查结果：

```text
app_shell_occurrences=1
page_layout_imports=6
page_level_antd_layout_imports=0
shared_component_source_files=5
global_style_changed=False
working_tree_clean=True
navigation_pages=6
route_keys=6
navigation_without_route=0
duplicate_route_paths=0
```

最后一次 `proto lint` 和生产构建均通过。已完成桌面浏览器功能检查；没有执行移动端检查，符合用户确认的范围。

Gate A 尚不能最终宣告通过：用户需要基于最终页面截图或真实浏览器，主观确认“没有明显风格漂移、Navigation 仍然一致”。

### Gate B：已通过

两类错误均在隔离副本中制造，并由 Lint 阻断：

- Product Model 越界：命中 `L006`，文本显示 `Result: BLOCKED`，JSON 退出码为 `1`。
- 页面 Scope 越界：命中 `L001`，精确文件为 `prototype/src/pages/DashboardPage.tsx`，文本显示 `Result: BLOCKED`，JSON 退出码为 `1`。

不要把两个负例合并回主工作区。

### Gate C：材料包已就绪，等待盲测

盲测包只包含 `Spec + Product Diff + Prototype`，没有源码：

```text
01-spec-requirement.md
02-product-diff.txt
03-semantic-diff.md
04-prototype-default.png
05-prototype-add-drawer.png
06-prototype-added.png
```

Gate C 尚未通过，因为还没有拿到一个不看代码的理解结果。

### Gate D：未执行

需要创建全新隔离副本，并让新 Agent / 新 Session 在没有之前聊天记录的情况下继续开发。

### Gate E：未完成

需要先整理客观成本事实，再由用户本人判断维护这一套流程是否“没有比实际画原型更累”。

## 4. 剩余任务清单

按以下顺序执行。

### 任务 1：Gate D — Fresh Context

#### 1.1 创建完全独立的副本

先确认目标目录不存在；如果已经存在，不要覆盖或删除，先检查其状态并换一个带时间戳的新目录。

建议命令：

```powershell
$source = 'E:\AIProject\AI原型工具\output\gate-validation\workspace'
$target = 'E:\AIProject\AI原型工具\output\gate-validation\fresh-context-workspace'
Test-Path -LiteralPath $target
git clone --local $source $target
```

不要把 `.proto.llm.yaml` 复制到 Fresh Context 副本；这个 Gate 不需要 Semantic Diff，也不需要外发代码。

#### 1.2 派发给真正没有上下文的新 Agent / 新 Session

协调 Agent 不得亲自实现这个 Fresh Context 需求。必须启动一个不继承聊天历史的新 Agent，且只发送下面这段最小任务说明；不要附加命令、实现建议、已完成 Gate 信息或本交接文档内容：

```text
你接手一个没有聊天历史的 Prototype Workspace。
路径：E:\AIProject\AI原型工具\output\gate-validation\fresh-context-workspace
需求：设备查询增加“设备标识类型”选择，支持 IDFA、OAID、Android ID 和 Device ID，导航保持不变。
请完全根据仓库内说明继续开发，完成你认为必要的规范、实现和本地验证；不要依赖任何先前聊天。完成后报告操作、验证结果和遇到的阻碍。
```

如果执行平台无法创建无历史 Agent，则新建一个完全独立的新任务/会话来执行；不能用当前会话假装 Fresh Context。

#### 1.3 对新 Agent 的结果做客观验收

新 Agent 完成后，协调 Agent只做检查，不替它补关键流程。检查并记录：

- 是否主动读取仓库内工作说明（重点关注 `.ai/SKILL.md` 或仓库提供的等价入口）。
- 是否基于现有 Product Model 和页面结构理解需求。
- 是否创建了新的 Feature 规范，而不是直接裸改页面。
- Scope 是否只授权设备查询相关页面/文件。
- 是否保持导航和路由不变。
- 是否复用现有 `PageLayout`、表单或共享组件，未创建第二套 Layout。
- `proto lint` 是否 PASS。
- `prototype` 的 `npm run build` 是否 PASS。
- 新 Agent 是否在没有询问历史聊天内容的情况下完成。

建议验证：

```powershell
$fresh = 'E:\AIProject\AI原型工具\output\gate-validation\fresh-context-workspace'
Push-Location $fresh
git status --short
git branch --show-current
proto feature status
proto lint
Pop-Location

Push-Location (Join-Path $fresh 'prototype')
npm run build
Pop-Location
```

再检查 `product/navigation.yaml` 和 `product/routes.yaml` 没有被修改。若新 Agent 的关键流程失败，不要替它静默修正后声称 Gate D 通过；应保留原始失败事实并判为 `FAIL` 或 `BLOCKED`。

将验收记录保存为：

```text
E:\AIProject\AI原型工具\output\gate-validation\evidence\gate-d-fresh-context.md
```

Gate D 通过标准：新 Agent 在无聊天历史的条件下，能依靠仓库材料完成新需求，并通过 Lint 和 Build，同时不破坏 Navigation。

### 任务 2：Gate E — 整理 PM 成本事实

创建：

```text
E:\AIProject\AI原型工具\output\gate-validation\evidence\gate-e-cost-facts.md
```

至少如实记录以下事实，不要估算或捏造人工耗时：

- 三个需求均完成 Feature 规范、Scope、Lint、Diff、实现、构建和浏览器验收后合并。
- `REQ-GATE-001` 首次 Scope 仅写页面 ID 时，CamelCase 页面文件没有被自动映射，Lint 命中 `L001`；后来补了显式路径。这个是实际工作流摩擦。
- `REQ-GATE-001` 的 Semantic Diff 发现日期选择存在但没有真正过滤，并暴露了设备标识展示/匹配语义需要澄清；因此发生了修正循环。这个是流程产生的实际价值。
- `REQ-GATE-002` 的 Semantic Diff 需要一次明确的外部 LLM 数据发送授权；输出未发现阻断项。
- `REQ-GATE-003` 没有执行 Semantic Diff，因为没有把上一需求的外发授权扩大到新需求；Lint、确定性 Diff、Build 和浏览器检查已完成。
- 所有页面都存在一个基线技术债：Ant Design v5 对 React 19 的兼容性警告。该警告在 Feature 前后均存在，不能误报为本次回归。
- 构建存在大 chunk 警告（超过 1000 kB），需记为工程观察项，但不是当前 Gate 定义中的阻断条件。
- 用户已做过的流程决策包括：没有真实 backlog、LLM 改为配置文件、跳过移动端、对 `REQ-GATE-002` 外发作出明确授权。
- 无法可靠测得用户主动操作时长；必须明确写“未测量”，不能补一个猜测值。

Gate E 的最终结论必须由用户本人给出。建议只问这一句：

> 基于这次实际过程，你认为维护 Spec、Scope、Diff 和验收材料是否没有比直接画原型更累？请按“可以接受 / 明显更累”回答，并可补一句最费力的环节。

### 任务 3：完成 Gate A 的人工视觉验收

先确认本地预览仍可访问：

```powershell
Invoke-WebRequest -UseBasicParsing 'http://127.0.0.1:5173'
```

如果不可访问，在主工作区启动：

```powershell
Push-Location 'E:\AIProject\AI原型工具\output\gate-validation\workspace'
proto preview --no-install
```

最终截图位于：

```text
E:\AIProject\AI原型工具\output\playwright\gate-validation\final-dashboard.png
E:\AIProject\AI原型工具\output\playwright\gate-validation\final-attribution-rules.png
E:\AIProject\AI原型工具\output\playwright\gate-validation\final-attribution-results.png
E:\AIProject\AI原型工具\output\playwright\gate-validation\final-device-query.png
E:\AIProject\AI原型工具\output\playwright\gate-validation\final-device-whitelist.png
E:\AIProject\AI原型工具\output\playwright\gate-validation\final-media-config.png
```

请把六张截图展示给用户，或请用户打开本地预览，只让用户判断一件事：连续三个需求后是否存在“明显风格漂移或 Navigation 不一致”。不要让用户重复判断 Layout/组件重复，这两项已有结构证据。

建议提问：

> 请查看六个最终页面后判断：是否存在明显风格漂移或 Navigation 不一致？

只有用户回答没有明显问题，Gate A 才能最终标记 `PASS`。

### 任务 4：执行 Gate C 盲测

必须让评审者只读取 `gate-c-package`，不得看源码、Git diff 原文以外的仓库内容、本交接文档的答案键或历史聊天。

请评审者基于材料包回答以下七点：

1. 这个 Feature 要解决什么问题？
2. 谁会使用它？
3. 从哪里进入？
4. 添加设备的主操作流程是什么？
5. 能看出哪些状态、校验或操作结果？
6. Product Model 发生了什么变化？
7. 哪些能力明显不在本 Feature 范围内？

协调 Agent 的答案键（不要复制进盲测包，也不要先展示给评审者）：

- 问题：集中管理联调期间临时放行的设备白名单。
- 用户：产品、测试或联调相关的内部人员。
- 入口：归因管理导航下的“联调白名单”，独立路由页面。
- 主流程：点击添加设备，打开抽屉，选择设备类型、填写标识和有效天数，提交后成功提示并出现在列表中。
- 状态/结果：默认列表、筛选、必填校验、添加成功、空状态；设备标识以脱敏形式展示。
- Product Model：增加一个导航节点和对应路由，不改变既有导航结构。
- 范围外：后端持久化、删除、批量导入、审批、全局主题或共享组件重构。

判定规则：七点中第 1、3、4、6 点必须准确，其余三点允许措辞不同但含义基本一致。满足则 Gate C `PASS`；否则记录不理解的具体点并判 `FAIL`，不能由协调 Agent替评审者补答案。

将评审原始回答和逐项判定保存为：

```text
E:\AIProject\AI原型工具\output\gate-validation\evidence\gate-c-review.md
```

### 任务 5：生成最终验收报告

创建：

```text
E:\AIProject\AI原型工具\output\gate-validation\evidence\gate-final-report.md
```

报告至少包含：

| Gate | 最终状态 | 判定人 | 核心依据 | 证据路径 |
| --- | --- | --- | --- | --- |
| A Prototype 可持续性 | PASS/FAIL/PENDING | 自动检查 + 用户 | 结构、Lint、Build、截图和用户视觉结论 | 对应证据 |
| B Governance | PASS | 自动检查 | L006 与 L001 均 BLOCK，退出码 1 | 两组 txt/json |
| C Change Understanding | PASS/FAIL/PENDING | 盲测评审者 | 七项理解问答 | `gate-c-review.md` |
| D Fresh Context | PASS/FAIL/BLOCKED | 新 Agent + 协调 Agent | 无历史继续开发、Lint/Build、导航未改 | `gate-d-fresh-context.md` |
| E PM 成本 | PASS/FAIL/PENDING | 用户 | 客观成本事实 + 用户主观判断 | `gate-e-cost-facts.md` |

总体状态只有在 A–E 全部为 `PASS` 时才能写 `PASS`。任一项目还缺用户判断时，应明确写 `PENDING`，不要提前宣布“全部通过”。

## 5. 已有证据索引

### Gate A

- `evidence\gate-a-final-lint.txt`
- `evidence\gate-a-structural.txt`
- `evidence\gate-a-req-001-final-diff.txt`
- `evidence\gate-a-req-001-final-semantic.md`
- `evidence\gate-a-req-002-diff.txt`
- `evidence\gate-a-req-002-semantic.md`
- `evidence\gate-a-req-003-diff.txt`
- 三个需求对应的 Lint 文本
- `output\playwright\gate-validation\*.png`

### Gate B

- `evidence\gate-b-product-text.txt`
- `evidence\gate-b-product.json`
- `evidence\gate-b-page-text.txt`
- `evidence\gate-b-page.json`

### Gate C

- `evidence\gate-c-package\` 下六个文件

## 6. 执行注意事项

- 主工作区是嵌套 Git 仓库，Git 操作应在 `...\gate-validation\workspace` 或 Fresh Context 副本中执行，不要误在工具源码根目录提交。
- 所有负例都必须留在隔离副本；不要合并、复制回主工作区。
- 不需要移动端测试。
- 不要把浏览器里预先存在的 React 19 / Ant Design 兼容性警告当成三个 Feature 引入的回归，但应在报告中列为基线技术债。
- 只凭源码或 Build PASS 不足以替代用户可见结果；Gate A 必须包含最终截图/真实页面判断。
- 如果要对 `REQ-GATE-003` 或 Fresh Context 需求执行 `proto diff --semantic`，必须先单独说明将发送哪些内容到哪个 LLM，并重新取得用户明确授权。
- PowerShell 中优先使用 `-LiteralPath` 处理中文和特殊路径。
- 不删除现有证据、截图、负例副本或 LLM 配置。

## 7. 交接完成条件

新的执行 Agent 完成以下事项后，任务才算真正结束：

- Gate D 已由无历史 Agent 执行并有独立证据。
- Gate E 客观成本事实已落盘，用户已给出主观结论。
- 用户已对 Gate A 视觉一致性作出结论。
- Gate C 已由不看代码的评审者完成问答并判定。
- `gate-final-report.md` 明确列出 A–E 状态和证据边界。
- 若任一 Gate 未通过，报告中明确失败点和下一步，不以“基本 OK”替代 Gate 定义。
