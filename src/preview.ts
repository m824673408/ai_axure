import { currentBranch, currentFeature } from './git.js';
import { runLint } from './lint.js';
import { loadScope } from './workspace.js';

export function previewEnvironment(root: string, base: NodeJS.ProcessEnv = process.env): NodeJS.ProcessEnv {
  let branch = 'unknown';
  let featureId = '';
  let featureName = '';
  let allowedPages = '';
  let lintStatus = 'UNKNOWN';

  try {
    branch = currentBranch(root) || 'detached';
    featureId = currentFeature(root) ?? '';
    if (featureId) {
      const scope = loadScope(root, featureId);
      featureName = scope?.feature.name ?? featureId;
      allowedPages = scope?.allowed.pages.join(',') ?? '';
      lintStatus = runLint(root).pass ? 'PASS' : 'BLOCKED';
    } else {
      lintStatus = 'NOT_APPLICABLE';
    }
  } catch {
    lintStatus = 'UNKNOWN';
  }

  return {
    ...base,
    VITE_PROTO_BRANCH: branch,
    VITE_PROTO_FEATURE_ID: featureId,
    VITE_PROTO_FEATURE_NAME: featureName,
    VITE_PROTO_ALLOWED_PAGES: allowedPages,
    VITE_PROTO_LINT_STATUS: lintStatus,
    VITE_PROTO_LINT_CHECKED_AT: new Date().toISOString(),
  };
}
