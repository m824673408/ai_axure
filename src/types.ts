export interface WorkspaceConfig {
  workspace: {
    name: string;
    version: string;
    base_branch: string;
  };
  paths: {
    product: string;
    features: string;
    prototype: string;
    components: string;
  };
  preview: {
    install_command: string;
    command: string;
    url: string;
  };
}

export interface ProductModel {
  product: { id: string; name: string; version: string };
  modules: Array<{ id: string; name: string }>;
}

export interface NavigationItem {
  module?: string;
  page?: string;
  name: string;
  children?: NavigationItem[];
}

export interface ScopeModel {
  feature: { id: string; name: string };
  allowed: {
    pages: string[];
    shared_components: string[];
    product_model: string[];
    paths: string[];
  };
  forbidden: string[];
}

export interface ChangedFile {
  path: string;
  status: 'A' | 'M' | 'D' | 'R' | 'U';
}

export interface LintIssue {
  code: 'L001' | 'L002' | 'L003' | 'L004' | 'L005' | 'L006' | 'L007' | 'L008' | 'L009' | 'L010' | 'L011';
  title: string;
  message: string;
  /** YAML/JSON 字段路径，例如 routes.attribution_rule.module（P0-1 起）。 */
  field?: string;
  /** 可执行的修复建议（P0-1 起）。 */
  fix?: string;
  file?: string;
}

export interface LintResult {
  pass: boolean;
  feature: string | null;
  changedFiles: ChangedFile[];
  checks: string[];
  issues: LintIssue[];
}
