import { describe, expect, it } from 'vitest';
import { authorizePath, componentNameFromPath } from '../src/scope.js';
import type { ScopeModel } from '../src/types.js';

const scope: ScopeModel = {
  feature: { id: 'REQ-001', name: '测试需求' },
  allowed: {
    pages: ['attribution_rule'],
    shared_components: ['StatusTag'],
    product_model: ['routes'],
    paths: ['prototype/src/features/rule-history/**'],
  },
  forbidden: ['product/permissions.yaml'],
};

describe('scope authorization', () => {
  it('allows the feature directory and explicit paths', () => {
    expect(authorizePath('features/REQ-001/requirement.md', scope).allowed).toBe(true);
    expect(authorizePath('prototype/src/features/rule-history/index.tsx', scope).allowed).toBe(true);
  });

  it('applies forbidden rules before product authorization', () => {
    expect(authorizePath('product/routes.yaml', scope).allowed).toBe(true);
    expect(authorizePath('product/permissions.yaml', scope)).toMatchObject({ allowed: false, reason: 'forbidden' });
  });

  it('authorizes named pages and shared components', () => {
    expect(authorizePath('specs/attribution_rule.md', scope).allowed).toBe(true);
    expect(authorizePath('prototype/src/components/shared/StatusTag.tsx', scope).allowed).toBe(true);
    expect(authorizePath('prototype/src/components/shared/PageLayout.tsx', scope).allowed).toBe(false);
    expect(componentNameFromPath('prototype/src/components/shared/StatusTag.tsx')).toBe('StatusTag');
  });
});
