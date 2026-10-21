declare namespace configInstallCommandTypes {
  type InstallMethod = "bun-binary" | "npm" | "pnpm" | "yarn" | "bun" | "unknown";

  interface SelfUpdateCommandStep {
    command: string;
    args: string[];
    display: string;
  }

  interface SelfUpdateCommand extends SelfUpdateCommandStep {
    steps?: SelfUpdateCommandStep[];
  }

  type SelfUpdatePackageTarget = string | { packageName: string; installSpec?: string };
}

export type { configInstallCommandTypes as default };
