import type { ReactNode } from 'react';
import { Typography } from 'antd';

interface PageLayoutProps {
  title: string;
  description: string;
  actions?: ReactNode;
  children: ReactNode;
}

export function PageLayout({ title, description, actions, children }: PageLayoutProps) {
  return (
    <section className="page-layout" aria-labelledby="page-title">
      <header className="page-header">
        <div><Typography.Title id="page-title" level={1}>{title}</Typography.Title><Typography.Paragraph>{description}</Typography.Paragraph></div>
        {actions ? <div className="page-actions">{actions}</div> : null}
      </header>
      {children}
    </section>
  );
}
