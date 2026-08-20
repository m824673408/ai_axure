import { CheckCircleFilled, ClockCircleFilled, StopFilled } from '@ant-design/icons';
import { Tag } from 'antd';

const states = {
  active: { label: '已启用', icon: <CheckCircleFilled /> },
  archived: { label: '已归档', icon: <StopFilled /> },
  pending: { label: '待生效', icon: <ClockCircleFilled /> },
};

export function StatusTag({ status }: { status: keyof typeof states }) {
  const state = states[status];
  return <Tag className={`status-tag status-${status}`} icon={state.icon}>{state.label}</Tag>;
}
