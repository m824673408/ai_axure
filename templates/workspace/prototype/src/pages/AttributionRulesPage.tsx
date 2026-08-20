import { useMemo, useState } from 'react';
import { HistoryOutlined, PlusOutlined, SearchOutlined } from '@ant-design/icons';
import { Button, Input, Select, Space, Typography } from 'antd';
import type { ColumnsType } from 'antd/es/table';
import { DataTable, MediaSelector, PageLayout, SearchForm, StatusTag } from '../components/shared';
import { RuleVersionDrawer } from '../features/attribution-rule-version/RuleVersionDrawer';

interface RuleRow { key: string; name: string; media: string; account: string; model: string; window: string; status: 'active' | 'pending' | 'archived'; updated: string }

const data: RuleRow[] = [
  { key: '1', name: '应用激活归因规则', media: '巨量引擎', account: '星海游戏主账户', model: '末次点击', window: '24 小时', status: 'active', updated: '2026-08-18 16:30' },
  { key: '2', name: '付费事件归因规则', media: '腾讯广告', account: '增长中心', model: '末次点击', window: '12 小时', status: 'active', updated: '2026-08-16 11:20' },
  { key: '3', name: '再营销回流规则', media: '磁力引擎', account: '效果广告账户', model: '首次点击', window: '7 天', status: 'pending', updated: '2026-08-14 09:45' },
];

export default function AttributionRulesPage() {
  const [drawer, setDrawer] = useState<RuleRow | null>(null);
  const [keyword, setKeyword] = useState('');
  const [media, setMedia] = useState<string>();
  const rows = useMemo(() => data.filter((row) => (!keyword || row.name.includes(keyword)) && (!media || row.media === ({ ocean: '巨量引擎', tencent: '腾讯广告', kuaishou: '磁力引擎' } as Record<string, string>)[media])), [keyword, media]);
  const columns: ColumnsType<RuleRow> = [
    { title: '规则名称', dataIndex: 'name', fixed: 'left', width: 210, render: (value) => <Typography.Text strong>{value}</Typography.Text> },
    { title: '媒体', dataIndex: 'media', width: 120 },
    { title: '广告账户', dataIndex: 'account', width: 160 },
    { title: '归因模型', dataIndex: 'model', width: 110 },
    { title: '归因窗口', dataIndex: 'window', width: 100 },
    { title: '状态', dataIndex: 'status', width: 100, render: (value: RuleRow['status']) => <StatusTag status={value} /> },
    { title: '更新时间', dataIndex: 'updated', width: 150 },
    { title: '操作', key: 'action', fixed: 'right', width: 190, render: (_, record) => <Space><Button type="link">编辑规则</Button><Button type="link" icon={<HistoryOutlined />} onClick={() => setDrawer(record)}>查看历史版本</Button></Space> },
  ];
  return (
    <PageLayout title="归因规则" description="维护归因模型、窗口与账户范围；每次保存都会产生可审查版本。" actions={<Button type="primary" icon={<PlusOutlined />}>新建规则</Button>}>
      <SearchForm actions={<><Button type="primary" icon={<SearchOutlined />}>查询规则</Button><Button onClick={() => { setKeyword(''); setMedia(undefined); }}>重置条件</Button></>}>
        <Input aria-label="规则名称" value={keyword} onChange={(event) => setKeyword(event.target.value)} placeholder="输入规则名称" allowClear />
        <MediaSelector value={media} onChange={setMedia} />
        <Select aria-label="规则状态" placeholder="全部状态" allowClear options={[{ value: 'active', label: '已启用' }, { value: 'pending', label: '待生效' }]} />
      </SearchForm>
      <div className="table-summary"><Typography.Text>共 <strong>{rows.length}</strong> 条规则</Typography.Text><Typography.Text type="secondary">历史版本只读，当前版本可编辑</Typography.Text></div>
      <DataTable columns={columns} dataSource={rows} rowKey="key" />
      <RuleVersionDrawer open={Boolean(drawer)} ruleName={drawer?.name} onClose={() => setDrawer(null)} />
    </PageLayout>
  );
}
