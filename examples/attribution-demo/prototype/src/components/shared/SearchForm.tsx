import type { ReactNode } from 'react';

export function SearchForm({ children, actions }: { children: ReactNode; actions: ReactNode }) {
  return <div className="search-form" role="search"><div className="search-fields">{children}</div><div className="search-actions">{actions}</div></div>;
}
