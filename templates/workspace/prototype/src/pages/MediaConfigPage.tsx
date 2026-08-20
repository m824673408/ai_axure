import { SettingOutlined } from '@ant-design/icons';
import { Button, Switch, Typography } from 'antd';
import { PageLayout, StatusTag } from '../components/shared';

const media = [{ name: '巨量引擎', code: 'ocean', accounts: 12, enabled: true }, { name: '腾讯广告', code: 'tencent', accounts: 8, enabled: true }, { name: '磁力引擎', code: 'kuaishou', accounts: 4, enabled: false }];

export default function MediaConfigPage() {
  return <PageLayout title="媒体配置" description="维护媒体接入状态与广告账户范围。" actions={<Button type="primary">添加媒体账户</Button>}><div className="media-list">{media.map((item) => <article className="media-row" key={item.code}><div className="media-symbol" aria-hidden="true">{item.name.slice(0, 1)}</div><div className="media-copy"><Typography.Title level={2}>{item.name}</Typography.Title><Typography.Text type="secondary">{item.accounts} 个广告账户 · 标识 {item.code}</Typography.Text></div><StatusTag status={item.enabled ? 'active' : 'archived'} /><Switch checked={item.enabled} aria-label={`${item.name}接入状态`} /><Button icon={<SettingOutlined />}>配置账户</Button></article>)}</div></PageLayout>;
}
