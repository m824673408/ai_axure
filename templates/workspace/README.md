# 归因平台 Prototype Workspace

这是由 `proto init` 生成的统一产品原型工程，包含 Product Model、Demo Feature 与可运行 React Prototype。

## 开始使用

```bash
proto context
proto feature create REQ-001 --name "规则历史版本"
proto lint
proto diff
proto preview
```

`proto preview` 会在首次启动时安装 `prototype` 依赖。所有开发必须位于 `feature/*` 分支，Product Model 和公共组件变更必须在 Scope 中显式授权。

Semantic Diff 使用 `PROTO_LLM_BASE_URL`、`PROTO_LLM_API_KEY`、`PROTO_LLM_MODEL`；密钥不得写入仓库。
