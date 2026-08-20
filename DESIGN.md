# Design System

## Theme

产品经理在办公室明亮屏幕环境中审查结构化原型与治理结果。采用高可读的浅色产品界面，色彩策略为 Restrained。

## Color Palette

- Background: `oklch(1 0 0)`
- Surface: `oklch(0.975 0.004 0)`
- Surface strong: `oklch(0.945 0.007 0)`
- Ink: `oklch(0.235 0.025 0)`
- Muted ink: `oklch(0.47 0.025 0)`
- Primary: `oklch(0.41 0.13 5)`
- Primary hover: `oklch(0.47 0.145 5)`
- Accent: `oklch(0.49 0.12 245)`
- Success: `oklch(0.5 0.13 150)`
- Warning: `oklch(0.64 0.14 75)`
- Error: `oklch(0.53 0.2 28)`

所有正文与背景对比度不低于 4.5:1；饱和色填充使用白色文字。

## Typography

使用 `"Segoe UI Variable", "PingFang SC", "Microsoft YaHei", system-ui, sans-serif` 单一系统字体栈。页面标题 24px/700，区块标题 18px/650，正文 14px/400，辅助信息 13px/400。

## Layout

桌面端使用 224px 左侧导航、56px 顶栏和最大 1440px 内容区。小于 900px 时侧栏转为 Drawer，表格允许横向滚动。页面间距使用 8px 基准尺度。

## Components

Ant Design 负责标准交互；通过统一 token 控制颜色、圆角和焦点。卡片最大圆角 12px，不同时叠加宽阴影与装饰边框。状态标签必须含可读文字。

## Motion

状态切换控制在 150–220ms，仅使用 ease-out；`prefers-reduced-motion: reduce` 时移除非必要动画与平滑滚动。
