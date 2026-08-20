import { DownloadOutlined, SearchOutlined } from '@ant-design/icons';
import { Button, DatePicker, Input, Typography } from 'antd';
import { DataTable, PageLayout, SearchForm, StatusTag } from '../components/shared';

const rows = [
  { key: '1', device: 'A8F2•••91CD', event: '首次付费', media: '巨量引擎', campaign: '暑期拉新-Android', time: '2026-08-20 10:21:34', status: 'active' as const },
  { key: '2', device: '6B91•••E240', event: '应用激活', media: '腾讯广告', campaign: '品牌词-iOS', time: '2026-08-20 10:18:09', status: 'active' as const },
];

export default function AttributionResultsPage() {
  return <PageLayout title="归因结果" description="按设备和事件查看归因命中结果。" actions={<Button icon={<DownloadOutlined />}>导出结果</Button>}><SearchForm actions={<Button type="primary" icon={<SearchOutlined />}>查询结果</Button>}><Input aria-label="设备标识" placeholder="输入 Device ID" /><DatePicker.RangePicker aria-label="事件时间范围" /></SearchForm><div className="table-summary"><Typography.Text>最近结果</Typography.Text><Typography.Text type="secondary">数据更新时间：2026-08-20 10:22</Typography.Text></div><DataTable dataSource={rows} columns={[{ title: '设备标识', dataIndex: 'device' }, { title: '事件', dataIndex: 'event' }, { title: '归因媒体', dataIndex: 'media' }, { title: '广告计划', dataIndex: 'campaign' }, { title: '事件时间', dataIndex: 'time' }, { title: '状态', dataIndex: 'status', render: (value) => <StatusTag status={value} /> }]} /></PageLayout>;
}
