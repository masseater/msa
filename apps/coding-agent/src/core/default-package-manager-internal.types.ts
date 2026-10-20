import type ignore from "ignore";

import type gitTypes from "../utils/git.types.ts";
import type packageManagerTypes from "./package-manager.types.ts";

declare namespace defaultPackageManagerInternalTypes {
  type NpmSource = {
    type: "npm";
    spec: string;
    name: string;
    version?: string | undefined;
    range?: string | undefined;
    pinned: boolean;
  };

  type LocalSource = {
    type: "local";
    path: string;
  };

  type ParsedSource = NpmSource | gitTypes.GitSource | LocalSource;

  type InstalledSourceScope = Exclude<packageManagerTypes.SourceScope, "temporary">;

  interface ConfiguredUpdateSource {
    source: string;
    scope: InstalledSourceScope;
  }

  interface NpmUpdateTarget extends ConfiguredUpdateSource {
    parsed: NpmSource;
  }

  interface GitUpdateTarget extends ConfiguredUpdateSource {
    parsed: gitTypes.GitSource;
  }

  interface ResourceAccumulator {
    extensions: Map<string, { metadata: packageManagerTypes.PathMetadata; enabled: boolean }>;
    skills: Map<string, { metadata: packageManagerTypes.PathMetadata; enabled: boolean }>;
    prompts: Map<string, { metadata: packageManagerTypes.PathMetadata; enabled: boolean }>;
    themes: Map<string, { metadata: packageManagerTypes.PathMetadata; enabled: boolean }>;
  }

  interface PackageFilter {
    autoload?: boolean;
    extensions?: string[];
    skills?: string[];
    prompts?: string[];
    themes?: string[];
  }

  type ResourceType = "extensions" | "skills" | "prompts" | "themes";

  type IgnoreMatcher = ReturnType<typeof ignore>;

  type SkillDiscoveryMode = "msa" | "agents";
}

export type { defaultPackageManagerInternalTypes as default };
