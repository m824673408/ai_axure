export type PreviewLintStatus = 'PASS' | 'BLOCKED' | 'NOT_APPLICABLE' | 'UNKNOWN';

const featureId = import.meta.env.VITE_PROTO_FEATURE_ID?.trim() || null;

export const previewContext = {
  branch: import.meta.env.VITE_PROTO_BRANCH?.trim() || 'main',
  featureId,
  featureName: import.meta.env.VITE_PROTO_FEATURE_NAME?.trim() || featureId || 'Baseline 演示',
  allowedPages: (import.meta.env.VITE_PROTO_ALLOWED_PAGES ?? '').split(',').map((item: string) => item.trim()).filter(Boolean),
  lintStatus: (import.meta.env.VITE_PROTO_LINT_STATUS?.trim() || 'UNKNOWN') as PreviewLintStatus,
  lintCheckedAt: import.meta.env.VITE_PROTO_LINT_CHECKED_AT?.trim() || null,
};
