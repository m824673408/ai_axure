# AI Product Prototype Workspace V0.1

基于 Git、Product Model、Feature Scope 与确定性 Lint 的 AI 原型协作基础设施。它让多个产品经理在同一个可运行 React 原型中并行开发，并在 Review 前阻断越权修改。

## 交付内容

- TypeScript + Commander CLI：`init`、`context`、`feature create/status`、`lint`、`diff`、`preview`、`studio`、`release`
- 本机 PM 管理台：需求、Scope、场景、产品结构、检查与 Preview 的表单化入口
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
proto init E:\prototype-workspace
```

本机未安装 Python，因此 V0.1 选择需求文档允许的 Node.js + Commander.js 方案。运行环境要求 Node.js 20+ 与 Git。

## CLI

```text
proto init [directory] [--no-git]
proto context [--json]
proto feature create <FEATURE_ID> --name <NAME>
proto feature status [--json]
proto lint [--json]
proto diff [--json]
proto diff --semantic [--dry-run]
proto preview [--no-install]
proto studio [--port 3210] [--no-open]
proto release <SEMVER>
```

`proto init` 只写入空目录，默认初始化 `main` 并创建基线提交。`proto feature create` 只允许从干净的基线分支创建 `feature/<FEATURE_ID>`。

## PM 管理台

在已初始化的 Workspace 目录执行：

```powershell
proto studio
```

浏览器会自动打开 `http://127.0.0.1:3210`。管理台只监听本机回环地址，没有登录、云同步、发布、合并或 Push 功能。它会继续使用同一套 Git 分支、Feature Scope 与确定性 Lint：产品结构保存必须在 `feature/*` 分支，并且需要你先在“需求 - 修改范围”里明确授权。关闭 Studio 时，只会停止它自己启动的 Preview。

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

`proto release 0.1.0` 只允许在干净的 `main` 执行。命令会运行 Lint、更新版本与 CHANGELOG、创建发布提交及 `prototype-v0.1.0` Annotated Tag，但不会 push。

## 目录

- `src/`：CLI Source
- `schemas/`：Product Model 与 Scope Schema
- `templates/workspace/`：可复制 Workspace 与 Prototype Template
- `examples/attribution-demo/`：由 CLI 生成的 Example Project
- `tests/`：核心与集成测试

不包含在线工作台、拖拽编辑器、云 Preview、插件、自动 Merge 或复杂权限系统。
