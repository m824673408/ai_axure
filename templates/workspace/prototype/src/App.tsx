import { lazy, Suspense, useMemo, useState } from 'react';
import { BranchesOutlined, MenuOutlined, ProductOutlined } from '@ant-design/icons';
import { Button, Drawer, Layout, Menu, Spin, Tag, Typography } from 'antd';
import type { MenuProps } from 'antd';
import { Navigate, Route, Routes, useLocation, useNavigate } from 'react-router-dom';
import { navigationModel, productModel, routeModel } from './productModel';

const DashboardPage = lazy(() => import('./pages/DashboardPage'));
const AttributionRulesPage = lazy(() => import('./pages/AttributionRulesPage'));
const AttributionResultsPage = lazy(() => import('./pages/AttributionResultsPage'));
const DeviceQueryPage = lazy(() => import('./pages/DeviceQueryPage'));
const MediaConfigPage = lazy(() => import('./pages/MediaConfigPage'));

const { Header, Sider, Content } = Layout;

const pages: Record<string, React.ReactNode> = {
  dashboard: <DashboardPage />,
  attribution_rule: <AttributionRulesPage />,
  attribution_result: <AttributionResultsPage />,
  device_query: <DeviceQueryPage />,
  media_config: <MediaConfigPage />,
};

function App() {
  const [mobileOpen, setMobileOpen] = useState(false);
  const location = useLocation();
  const navigate = useNavigate();
  const menuItems = useMemo<MenuProps['items']>(() => navigationModel.map((module) => ({
    key: `module:${module.module}`,
    label: module.name,
    type: 'group',
    children: module.children?.map((page) => ({ key: page.page!, label: page.name })),
  })), []);
  const selected = Object.entries(routeModel).find(([, route]) => route.path === location.pathname)?.[0] ?? 'dashboard';
  const navigation = (
    <>
      <div className="brand-block">
        <div className="brand-mark" aria-hidden="true"><ProductOutlined /></div>
        <div><strong>{productModel.product.name}</strong><span>Prototype Workspace</span></div>
      </div>
      <Menu
        theme="dark"
        mode="inline"
        items={menuItems}
        selectedKeys={[selected]}
        onClick={({ key }) => { navigate(routeModel[key]?.path ?? '/'); setMobileOpen(false); }}
      />
    </>
  );
  return (
    <Layout className="app-shell">
      <Sider width={224} className="desktop-sider" breakpoint="lg" collapsedWidth="0" trigger={null}>{navigation}</Sider>
      <Drawer className="mobile-nav" open={mobileOpen} onClose={() => setMobileOpen(false)} placement="left" width={280} title="产品导航">{navigation}</Drawer>
      <Layout>
        <Header className="topbar">
          <Button className="mobile-menu-button" type="text" icon={<MenuOutlined />} aria-label="打开产品导航" onClick={() => setMobileOpen(true)} />
          <div className="topbar-context"><BranchesOutlined aria-hidden="true" /><span>当前演示需求</span><Tag bordered={false}>REQ-DEMO-001</Tag></div>
          <Typography.Text type="secondary" className="version-label">Product v{productModel.product.version}</Typography.Text>
        </Header>
        <Content id="main-content" className="main-content" tabIndex={-1}>
          <Suspense fallback={<div className="page-loading" role="status" aria-label="正在加载页面"><Spin size="large" /></div>}>
            <Routes>
              {Object.entries(routeModel).map(([id, route]) => <Route key={id} path={route.path} element={pages[id] ?? <Navigate to="/" replace />} />)}
              <Route path="*" element={<Navigate to="/" replace />} />
            </Routes>
          </Suspense>
        </Content>
      </Layout>
    </Layout>
  );
}

export default App;
