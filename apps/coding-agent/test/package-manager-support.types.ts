import type packageManagerSupport from "./package-manager-support.ts";

declare namespace packageManagerSupportTypes {
  interface PackageManagerInternals {
    runCommand(command: string, args: string[], options?: { cwd?: string }): Promise<void>;
    getPackageManagerName(): string;
    getGitDependencyInstallArgs(): string[];
    runCommandCapture(
      command: string,
      args: string[],
      options?: { cwd?: string; timeoutMs?: number; env?: Record<string, string> },
    ): Promise<string>;
    getLocalGitUpdateTarget(
      installedPath: string,
    ): Promise<{ ref: string; head: string; fetchArgs: string[] }>;
    parseSource(
      source: string,
    ):
      | { type: "npm"; spec: string; name: string; pinned: boolean }
      | { type: "git"; repo: string; host: string; path: string; pinned: boolean; ref?: string }
      | { type: "local"; path: string };
    getNpmInstallPath(
      source: { type: "npm"; spec: string; name: string; pinned: boolean },
      scope: "user" | "project" | "temporary",
    ): string;
    getGitInstallPath(
      source: {
        type: "git";
        repo: string;
        host: string;
        path: string;
        pinned: boolean;
        ref?: string;
      },
      scope: "user" | "project" | "temporary",
    ): string;
  }

  type MockSpawnedProcess = (typeof packageManagerSupport.MockSpawnedProcess)["prototype"];
}

export type { packageManagerSupportTypes as default };
