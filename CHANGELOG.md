# Changelog

## 0.2.0-rc.1 - 2026-09-12

- Product Diff 增加面向 PM 的可见名称、需求替换和可读变化摘要。
- 增加 Page/Component Registry、Schema 治理、自动页面授权和单命令 `proto check`。
- 修复 npm 安装包中的 Studio 静态资源路径和 Windows 初始化指引。
- 基础分支脏状态现在会阻断 `proto check`；`--out` 报告不再污染自身检查。
- Preview 展示当前 Feature 与启动时 Lint 快照，不再固定显示演示需求。
- 新 Feature 不再生成冗余的独立 Changelog；场景文件继续作为治理数据源。
