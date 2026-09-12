import React from 'react';
import ReactDOM from 'react-dom/client';
import '@ant-design/v5-patch-for-react-19';
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
          colorPrimary: '#8f2942',
          colorInfo: '#1769aa',
          colorSuccess: '#2f7a4f',
          colorWarning: '#ad6800',
          colorError: '#c53b32',
          colorText: '#2b2528',
          colorTextSecondary: '#6f666a',
          colorBgLayout: '#f8f7f7',
          borderRadius: 8,
          borderRadiusLG: 12,
          fontFamily: '"Segoe UI Variable", "PingFang SC", "Microsoft YaHei", system-ui, sans-serif',
          controlHeight: 36,
        },
        components: {
          Layout: { headerBg: '#ffffff', siderBg: '#2b2528' },
          Menu: { darkItemBg: '#2b2528', darkSubMenuItemBg: '#211c1e', darkItemSelectedBg: '#8f2942' },
          Table: { headerBg: '#f5f3f4' },
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
