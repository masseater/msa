import type DefaultPackageManagerClass from "./default-package-manager.ts";
import type settingsManagerTypes from "./settings-manager.types.ts";

declare namespace packageManagerTypes {
  interface PackageManagerOptions {
    cwd: string;
    agentDir: string;
    settingsManager: settingsManagerTypes.SettingsManager;
    builtinExtensions?: string[];
  }

  interface PathMetadata {
    source: string;
    scope: SourceScope;
    origin: "package" | "top-level";
    baseDir?: string;
    packageRoot?: string;
  }

  interface ResolvedResource {
    path: string;
    enabled: boolean;
    metadata: PathMetadata;
  }

  interface ResolvedPaths {
    extensions: ResolvedResource[];
    skills: ResolvedResource[];
    prompts: ResolvedResource[];
    themes: ResolvedResource[];
  }

  type MissingSourceAction = "install" | "skip" | "error";

  interface ProgressEvent {
    type: "start" | "progress" | "complete" | "error";
    action: "install" | "remove" | "update" | "clone" | "pull";
    source: string;
    message?: string;
  }

  type ProgressCallback = (event: ProgressEvent) => void;

  interface PackageUpdate {
    source: string;
    displayName: string;
    type: "npm" | "git";
    scope: Exclude<SourceScope, "temporary">;
  }

  interface ConfiguredPackage {
    source: string;
    scope: "user" | "project";
    filtered: boolean;
    installedPath?: string | undefined;
  }

  interface PackageManager {
    readonly resolution: {
      resolve(onMissing?: (source: string) => Promise<MissingSourceAction>): Promise<ResolvedPaths>;
      resolveExtensionSources(
        sources: string[],
        options?: { local?: boolean; temporary?: boolean },
      ): Promise<ResolvedPaths>;
    };
    readonly operations: {
      readonly install: {
        install(source: string, options?: { local?: boolean }): Promise<void>;
        installAndPersist(source: string, options?: { local?: boolean }): Promise<void>;
        remove(source: string, options?: { local?: boolean }): Promise<void>;
        removeAndPersist(source: string, options?: { local?: boolean }): Promise<boolean>;
      };
      readonly updates: { update(source?: string): Promise<void> };
    };
    readonly configured: {
      listConfiguredPackages(): ConfiguredPackage[];
      addSourceToSettings(source: string, options?: { local?: boolean }): boolean;
      removeSourceFromSettings(source: string, options?: { local?: boolean }): boolean;
      getInstalledPath(source: string, scope: "user" | "project"): string | undefined;
    };
    readonly progress: { setProgressCallback(callback: ProgressCallback | undefined): void };
  }

  type SourceScope = "user" | "project" | "temporary";

  type DefaultPackageManager = (typeof DefaultPackageManagerClass)["prototype"];
}

export type { packageManagerTypes as default };
