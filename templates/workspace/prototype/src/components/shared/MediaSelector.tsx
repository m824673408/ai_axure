import { Select } from 'antd';

export function MediaSelector({ value, onChange }: { value?: string; onChange?: (value: string) => void }) {
  return <Select aria-label="选择媒体" allowClear placeholder="全部媒体" value={value} onChange={onChange} options={[{ value: 'ocean', label: '巨量引擎' }, { value: 'tencent', label: '腾讯广告' }, { value: 'kuaishou', label: '磁力引擎' }]} />;
}
