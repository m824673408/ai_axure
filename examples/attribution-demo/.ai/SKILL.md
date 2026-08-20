# Product Prototype Agent Skill

你正在维护一个结构化 Product Prototype Workspace。

## 开始任何开发前

必须执行 `proto context`，并阅读当前 Feature 的 Requirement、Scope、Product Model 与 Component Registry。

## 修改原则

1. 只修改当前 Feature Scope 内文件。
2. 优先复用 Existing Shared Components。
3. 不得擅自修改 Product Model 或 Shared Components。
4. 不得直接修改 main。
5. 不得绕过 `proto lint`。

## 开发完成

依次执行 `proto lint`、`proto diff` 和 `proto preview`。Lint 失败时先修复，不得将 Semantic Diff 当作 Merge 裁决。
