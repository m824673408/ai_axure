import { HistoryOutlined } from '@ant-design/icons';
import { Descriptions, Drawer, Empty, Timeline, Typography } from 'antd';
import YAML from 'yaml';
import versionsSource from '../../../../mocks/attribution-rule-versions.yaml?raw';
import { StatusTag } from '../../components/shared';

interface VersionItem {
  version: string;
  updated_at: string;
  updated_by: string;
  click_window: string;
  status: 'active' | 'archived';
  note: string;
}

const versions = (YAML.parse(versionsSource) as { versions: VersionItem[] }).versions;

export function RuleVersionDrawer({ open, ruleName, onClose }: { open: boolean; ruleName?: string; onClose: () => void }) {
  return (
    <Drawer title={<span><HistoryOutlined aria-hidden="true" /> 版本历史</span>} open={open} onClose={onClose} width={520} destroyOnHidden footer={<Typography.Text type="secondary">历史版本仅供审查，不可直接修改。</Typography.Text>}>
      {ruleName ? <Typography.Paragraph className="drawer-lead"><strong>{ruleName}</strong> 的版本按更新时间倒序排列。</Typography.Paragraph> : null}
      {versions.length ? (
        <Timeline items={versions.map((item) => ({
          color: item.status === 'active' ? 'green' : 'gray',
          children: (
            <article className="version-entry" aria-label={`${item.version} ${item.note}`}>
              <div className="version-heading"><strong>{item.version}</strong><StatusTag status={item.status} /></div>
              <Typography.Paragraph>{item.note}</Typography.Paragraph>
              <Descriptions size="small" column={1} items={[
                { key: 'time', label: '更新时间', children: item.updated_at },
                { key: 'owner', label: '更新人', children: item.updated_by },
                { key: 'window', label: '点击窗口', children: item.click_window },
              ]} />
            </article>
          ),
        }))} />
      ) : <Empty description="还没有历史版本" />}
    </Drawer>
  );
}
