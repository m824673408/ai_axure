import React from 'react';
import ReactDOM from 'react-dom/client';
import { BrowserRouter } from 'react-router-dom';
import { App as AntApp, ConfigProvider } from 'antd';
import zhCN from 'antd/locale/zh_CN';
import App from './App';
import './styles.css';

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <ConfigProvider
      locale={zhCN}
      theme={{
        token: {
          colorPrimary: 'oklch(0.41 0.13 5)',
          colorInfo: 'oklch(0.49 0.12 245)',
          colorSuccess: 'oklch(0.5 0.13 150)',
          colorWarning: 'oklch(0.64 0.14 75)',
          colorError: 'oklch(0.53 0.2 28)',
          colorText: 'oklch(0.235 0.025 0)',
          colorTextSecondary: 'oklch(0.43 0.022 0)',
          colorBgLayout: 'oklch(0.975 0.004 0)',
          borderRadius: 8,
          borderRadiusLG: 12,
          fontFamily: '"Segoe UI Variable", "PingFang SC", "Microsoft YaHei", system-ui, sans-serif',
          controlHeight: 36,
        },
        components: {
          Layout: { headerBg: 'oklch(1 0 0)', siderBg: 'oklch(0.235 0.025 0)' },
          Menu: { darkItemBg: 'oklch(0.235 0.025 0)', darkSubMenuItemBg: 'oklch(0.205 0.02 0)', darkItemSelectedBg: 'oklch(0.41 0.13 5)' },
          Table: { headerBg: 'oklch(0.965 0.006 0)' },
        },
      }}
    >
      <AntApp>
        <BrowserRouter>
          <App />
        </BrowserRouter>
      </AntApp>
    </ConfigProvider>
  </React.StrictMode>,
);
