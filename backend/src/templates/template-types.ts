export type TemplateCategory = "web" | "mobile" | "game" | "engine" | "workflow";

export interface TemplateSetupConfig {
  engine: "bun" | "npm" | "pip" | "none";
  command: string[];
  timeoutMs?: number;
}

export interface TemplateDevServerConfig {
  type: "web" | "mobile" | "terminal" | "external";
  frontend?: {
    command?: string[];
    portEnv?: string;
    defaultPort?: number;
  };
  backend?: {
    entryFile?: string;
    command?: string[];
    portEnv?: string;
    defaultPort?: number;
  };
  preview?: {
    type: "iframe" | "terminal" | "external";
    brandBadge?: boolean;
  };
}

export interface TemplateManifest {
  id: string;
  name: string;
  version: string;
  category: TemplateCategory;
  description: string;
  icon?: string;
  placeholder?: string;
  tags?: string[];
  disabled?: boolean;
  comingSoon?: boolean;
  setup?: TemplateSetupConfig;
  devServer?: TemplateDevServerConfig;
  aiRules?: string[];
}

export interface TemplateSummary {
  id: string;
  name: string;
  category: TemplateCategory;
  description: string;
  icon: string;
  placeholder?: string;
  tags: string[];
  disabled?: boolean;
  comingSoon?: boolean;
}
