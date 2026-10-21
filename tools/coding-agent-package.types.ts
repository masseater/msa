import type codingAgentPackage from "./coding-agent-package.ts";

declare namespace codingAgentPackageTypes {
  interface PackageInfo {
    readonly packageJsonText: string;
    readonly repoRoot: string;
    readonly version: string;
  }

  type Workspace = (typeof codingAgentPackage.Workspace)["prototype"];
}

export type { codingAgentPackageTypes as default };
