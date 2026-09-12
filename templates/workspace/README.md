# 归因平台 Prototype Workspace

这是由 `proto init` 生成的统一产品原型工程，包含 Product Model、Demo Feature 与可运行 React Prototype。

## 开始使用

```bash
proto context
proto feature create REQ-001 --name "规则历史版本"
proto scope freeze
proto diff
proto check
proto preview
proto studio
```

`feature create` 后先完成 Requirement、Scope 和 Scenarios，再由 PM 执行 `proto scope freeze`。所有开发必须位于 `feature/*` 分支；缺少锁或修改了 Scope 时，`proto lint/check` 会以 L014 BLOCK。Product Model 和公共组件变更必须在 Scope 中显式授权。

本地锁只检测 Scope 漂移，不证明审批身份。GitHub Workspace 还必须保留 `CODEOWNERS`、固定版本的 `Prototype Gate / check` 和受保护的 `main` 分支。

## PM 管理台

在本 Workspace 根目录运行 `proto studio`，浏览器会打开本机管理台。它可用于创建和编辑当前需求、Scope、场景、产品结构，以及查看 Lint、Diff 和 Preview。管理台不提供 Release、合并或 Push；产品版本仍由 `proto release` 管理。

Semantic Diff 使用 Workspace 根目录的 `.proto.llm.yaml`。请复制 `.proto.llm.example.yaml` 后填写服务地址、API Key 与模型；真实配置文件已被 Git 忽略。环境变量仍可用于临时覆盖。
