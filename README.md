# AI Product Prototype Workspace V0.2 RC

基于 Git、Product Model、Feature Scope 与确定性 Lint 的 AI 原型协作基础设施。它让多个产品经理在同一个可运行 React 原型中并行开发，并在 Review 前阻断越权修改。

## 交付内容

- TypeScript + Commander CLI：增加 `scope status/freeze` 与 `governance setup/status`
- 本机 PM 管理台：需求、Scope 锁、场景、产品结构、检查与 Preview 的表单化入口
- YAML Product Model 与 JSON Schema
- React + Vite + Ant Design Prototype Template
- 归因平台 Demo Product 与 `REQ-DEMO-001` Demo Feature
- OpenAI 兼容 Semantic Diff
- Agent Skill、GitHub Actions 示例与自动测试

## 本地开发

```powershell
npm install
npm run verify
npm link
proto init E:\prototype-workspace --github-owner m824673408
```

运行环境要求 Node.js 20+ 与 Git。当前候选版本为 `0.2.0-rc.3`。

## CLI

```text
proto init [directory] --github-owner <LOGIN>
proto init [directory] --no-git
proto context [--json]
proto feature create <FEATURE_ID> --name <NAME> [--page <PAGE_ID>...]
proto feature status [--json]
proto scope status [--json]
proto scope freeze [--json]
proto governance setup --github-owner <LOGIN> --tool-ref <TAG>
proto governance status [--json]
proto lint [--json]
proto diff [--json]
proto diff --semantic [--dry-run]
proto check [--json] [--out <FILE>] [--no-build]
proto preview [--no-install]
proto studio [--port 3210] [--no-open]
proto release <SEMVER>
```

`proto init` 只写入空目录。Git 模式必须先提供 GitHub Owner；CLI 会写入 CODEOWNERS、固定工具 Tag 的 `Prototype Gate / check` 工作流，再初始化 `main` 并创建基线提交。缺少 Owner 时会在创建目录前拒绝；纯本地无 Git 工作区可使用 `--no-git`。

`proto feature create` 只允许从干净的基线分支创建 `feature/<FEATURE_ID>`。可重复传入 `--page`，CLI 会通过 Page Registry 自动把页面 ID 展开为实现文件和页面 Spec 授权：

```powershell
proto feature create REQ-20260912-001 --name "规则版本筛选" --page attribution_rule
proto scope freeze
proto check
```

`feature create` 不自动冻结范围。Requirement、Scope 和 Scenarios 填写完成后，由 PM 执行 `proto scope freeze`；缺锁、Feature 不匹配或 Scope 语义变化都会由 L014 阻断 `lint/check`。锁摘要忽略 YAML 排版、对象键和 Scope 数组顺序差异，但保留重复项。锁文件只检测漂移，不记录或证明审批身份。

`proto check` 是进入 Review 前的单命令门禁。基础分支存在未提交变更、Schema/Lint 失败、Scope 越界、GitHub 治理弱化、Registry 冲突或 Prototype 构建失败时都会返回非零退出码。`--out` 可写 JSON 报告；同一路径可连续执行，且不允许覆盖 Git 已跟踪文件。

已有 Workspace 可执行：

```powershell
proto governance setup --github-owner m824673408 --tool-ref v0.2.0-rc.3
```

命令遇到不同的现有 CODEOWNERS、Workflow 或治理配置会拒绝覆盖并输出人工合并依据。本地文件检查不能替代 GitHub 仓库设置；`main` 仍须配置 PR、Code Owner 审批、旧审批失效、`Prototype Gate / check`、会话解决、禁止强推/删除和禁止管理员绕过。

## PM 管理台

在已初始化的 Workspace 目录执行：

```powershell
proto studio
```

浏览器会自动打开 `http://127.0.0.1:3210`。管理台会显示 Scope 的 MISSING、STALE、LOCKED 状态并提供“冻结范围”操作；保存 Scope 后语义变化会立即显示 STALE。界面会明确提示本地冻结不是身份认证。管理台只监听本机回环地址，没有登录、云同步、发布、合并或 Push 功能。

如端口已被使用，可执行 `proto studio --port 3211`；不想自动打开浏览器时执行 `proto studio --no-open`。

## Scope 与 Lint

Feature Scope 通过页面 ID、公共组件名、Product Model 名称和 glob 路径授权。`forbidden` 永远优先。

| Code | Rule | Result |
| --- | --- | --- |
| L001 | Scope Violation | BLOCKED |
| L002 | Duplicate Route | BLOCKED |
| L003 | Missing Product Reference | BLOCKED |
| L004 | Missing Shared Component Registry | BLOCKED |
| L005 | Invalid Feature | BLOCKED |
| L006 | Product Model Unauthorized | BLOCKED |
| L014 | Scope Lock Required | BLOCKED |
| L015 | GitHub Governance Missing | BLOCKED |

Lint 差异集合包含 merge-base 之后的提交、暂存、未暂存与未跟踪文件。Semantic Diff 只解释变化，不参与 Merge 裁决。

## Semantic Diff

在 Prototype Workspace 根目录复制配置示例：

```powershell
Copy-Item .proto.llm.example.yaml .proto.llm.yaml
```

编辑 `.proto.llm.yaml`：

```yaml
base_url: https://provider.example/v1
api_key: your-api-key
model: model-name
timeout_ms: 60000
```

然后执行：

```powershell
proto diff --semantic
```

`.proto.llm.yaml` 已被 Workspace 的 `.gitignore` 忽略；可提交的 `.proto.llm.example.yaml` 不包含真实密钥。环境变量 `PROTO_LLM_BASE_URL`、`PROTO_LLM_API_KEY`、`PROTO_LLM_MODEL`、`PROTO_LLM_TIMEOUT_MS` 仍可作为配置文件的临时覆盖。使用 `proto diff --semantic --dry-run` 可以在发出网络请求前审查完整 Prompt。

## Release

`proto release 0.2.0` 只允许在干净的 `main` 执行。命令会运行 Lint、更新 Workspace 产品版本与 CHANGELOG、创建发布提交及 `prototype-v0.2.0` Annotated Tag，但不会 push。本工具的 RC.3 交付使用仓库 Annotated Tag `v0.2.0-rc.3`，不发布 npm。

## 目录

- `src/`：CLI Source
- `schemas/`：Product Model 与 Scope Schema
- `templates/workspace/`：可复制 Workspace 与 Prototype Template
- `examples/attribution-demo/`：由 CLI 生成的 Example Project
- `tests/`：核心与集成测试

不包含在线工作台、拖拽编辑器、云 Preview、插件、自动 Merge 或复杂权限系统。

## V0.2 RC 使用边界

- 适用于 GitHub PR + CODEOWNERS + 分支保护下的产品原型受控试用；本地锁只负责漂移检测。
- Preview 展示的是启动时 Feature 与 Lint 快照，进入 Review 必须以最新 `proto check` 为准。
- `scenarios.yaml` 仍是规则冲突检查和 Studio 场景编辑的数据源；V0.2 不再为新 Feature 生成重复的 Feature Changelog。
- 自动验收不调用外部 LLM；Semantic Diff 的内容质量由所配置模型决定，但不参与确定性门禁。
