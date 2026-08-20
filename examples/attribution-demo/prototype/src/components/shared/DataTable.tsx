import type { TableProps } from 'antd';
import { Table } from 'antd';

export function DataTable<T extends object>(props: TableProps<T>) {
  return <div className="data-table"><Table<T> size="middle" scroll={{ x: 'max-content' }} pagination={{ pageSize: 8, showSizeChanger: false, ...props.pagination }} {...props} /></div>;
}
