import { AimOutlined, SearchOutlined } from '@ant-design/icons';
import { Button, Empty, Input, Typography } from 'antd';
import { PageLayout } from '../components/shared';

export default function DeviceQueryPage() {
  return <PageLayout title="设备查询" description="输入设备标识，检查事件链路与归因状态。"><section className="query-hero" aria-labelledby="query-title"><div className="query-icon" aria-hidden="true"><AimOutlined /></div><Typography.Title id="query-title" level={2}>查询单个设备</Typography.Title><Typography.Paragraph>支持 IDFA、OAID、Android ID 与内部 Device ID。</Typography.Paragraph><div className="device-query-control"><Input.Search aria-label="设备标识" size="large" enterButton={<><SearchOutlined /> 查询设备</>} placeholder="输入完整设备标识" /></div></section><Empty className="result-empty" description="输入设备标识后，这里将展示事件时间线和归因证据" /></PageLayout>;
}
