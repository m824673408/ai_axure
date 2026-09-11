# Product Diff

## 页面

- 新增页面：`联调白名单`
  - 路由：`/attribution/device-whitelist`
  - 所属模块：归因管理（`attribution`）
  - 页面文件：`prototype/src/pages/DeviceWhitelistPage.tsx`
- 归因管理左侧导航新增入口：
  - 页面标识：`device_whitelist`
  - 名称：`联调白名单`
- 原型路由注册更新：
  - `prototype/src/App.tsx` 新增 `DeviceWhitelistPage` 懒加载
  - 将 `device_whitelist` 映射到 `DeviceWhitelistPage`

## 交互

- 用户从左侧“归因管理”进入“联调白名单”。
- 页面支持按以下条件查询设备：
  - 设备标识
  - 设备类型
  - 状态
- 查询条件按 AND 关系组合。
- 点击“重置条件”后清空查询条件，并恢复完整列表。
- 点击“添加设备”打开侧边抽屉表单。
- 添加设备表单包含：
  - 设备类型：必填
  - 完整设备标识：必填
  - 有效天数：必填，1 至 90 天
- 提交成功后：
  - 侧边表单关闭
  - 表单重置
  - 页面显示成功反馈
  - 新设备立即出现在列表顶部
- 列表中设备标识以脱敏形式展示。
- 页面提供“当前设备 N 台”的列表数量提示，并提示设备标识仅脱敏展示。

## 产品规则

- 设备标识和设备类型为必填项。
- 有效天数必须为 1 至 90 天。
- 新增设备默认状态为“已启用”。
- 新增设备创建人为“当前用户”。
- 列表中的设备标识必须脱敏展示。
- 查询条件按 AND 关系组合。
- 重置后恢复完整列表。
- 本 Feature 不修改全局主题和共享组件。
- 使用前端静态数据演示，不接入真实白名单接口。
- 删除、批量导入和审批不在本次范围内。

## Product Model

- `product/navigation.yaml` 更新：
  - 在归因管理下新增 `device_whitelist`，名称为“联调白名单”。
- `product/routes.yaml` 更新：
  - 新增 `device_whitelist` 路由。
  - 路径为 `/attribution/device-whitelist`。
  - 归属模块为 `attribution`。
- 未修改：
  - `product/product.yaml`
  - `product/terminology.yaml`
  - `product/permissions.yaml`

## Shared Component

- 本次未新增或修改共享组件。
- 联调白名单页面复用既有共享组件：
  - `PageLayout`
  - `SearchForm`
  - `DataTable`
  - `StatusTag`
- 未修改 `prototype/src/components/shared/**`。
- 未修改 `prototype/src/styles.css`。

## 风险

- 当前为前端静态数据演示，刷新页面后新增设备不会持久化，也不经过真实白名单接口校验。
- 列表仅展示脱敏设备标识，但查询输入框要求“完整设备标识”时可对原始设备标识进行匹配，用户可能因无法看到完整标识而难以查询。
- 新增设备固定创建人为“当前用户”，未接入真实用户体系。
- 状态包含“已启用 / 待生效 / 已归档”，但本次仅定义新增默认“已启用”，未定义状态流转、过期自动变更或归档规则。
- 有效期通过前端按天计算并展示为本地日期，未定义时区、跨天和过期后的业务处理。
- 删除、批量导入和审批明确不在本次范围内，当前页面无对应入口。
