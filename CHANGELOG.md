# Changelog

## 0.2.0-rc.3 - 2026-09-14

- 修复 GitHub Actions 从公开 Git Tag 全局安装时缺少构建依赖的问题；CI 现在在 runner 临时目录检出固定 Tag、完整构建后再安装 CLI。
- 保持工具源码不进入业务工作区，避免 Product Diff 和 Scope Lint 被工具安装目录污染。

## 0.2.0-rc.2 - 2026-09-12

- 新增确定性 Scope 锁与 `proto scope status/freeze`，L014 对缺失、错配和过期锁执行 BLOCK。
- 新增 `proto governance setup/status`、CODEOWNERS 与固定公开 Tag 的 GitHub `Prototype Gate / check`，L015 阻断治理文件缺失或弱化。
- Git 初始化要求 `--github-owner`；Studio 展示 MISSING、STALE、LOCKED 并支持 PM 冻结范围。
- CI detached HEAD 优先识别 `GITHUB_HEAD_REF`，基础分支缺失时回退 `origin/main`。

## 0.2.0-rc.1 - 2026-09-12

- Product Diff 增加面向 PM 的可见名称、需求替换和可读变化摘要。
- 增加 Page/Component Registry、Schema 治理、自动页面授权和单命令 `proto check`。
- 修复 npm 安装包中的 Studio 静态资源路径和 Windows 初始化指引。
- 基础分支脏状态现在会阻断 `proto check`；`--out` 报告不再污染自身检查。
- Preview 展示当前 Feature 与启动时 Lint 快照，不再固定显示演示需求。
- 新 Feature 不再生成冗余的独立 Changelog；场景文件继续作为治理数据源。
