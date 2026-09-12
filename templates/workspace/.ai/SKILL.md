# Product Prototype Agent Skill

你正在维护一个结构化 Product Prototype Workspace。

## 标准流程

1. 执行 `proto context`，读取 Product Model、Component Registry 与当前 Feature 上下文。
2. 完成 Requirement、Scope 与 Scenarios；这些 Markdown/YAML 文件用于说明和结构化表达，不能覆盖可执行门禁。
3. 由产品经理确认范围并执行 `proto scope freeze`。锁文件缺失或 Scope 语义变化时，`proto lint/check` 必须 BLOCK。
4. 仅在冻结范围内开发。
5. 完成后执行 `proto check`，再由 GitHub CODEOWNERS 与分支保护完成身份审批和合并门禁。

## 修改原则

1. 只修改当前 Feature Scope 内文件。
2. 优先复用 Existing Shared Components。
3. 不得擅自修改 Product Model 或 Shared Components。
4. 不得直接修改 main。
5. 不得绕过 Scope 锁、`proto lint` 或 `proto check`。
6. Studio 中保存 Product Model 前，也必须确认当前 Scope 明确授权了对应的 product_model 项。

## 开发完成

执行 `proto check` 和 `proto preview`。检查失败时先修复，不得将 Markdown 或 Semantic Diff 当作授权和 Merge 裁决。
