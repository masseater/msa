import type DefaultPackageManagerClass from "./default-package-manager.ts";

declare namespace packageManagerTypes {
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
    resolve(onMissing?: (source: string) => Promise<MissingSourceAction>): Promise<ResolvedPaths>;
    install(source: string, options?: { local?: boolean }): Promise<void>;
    installAndPersist(source: string, options?: { local?: boolean }): Promise<void>;
    remove(source: string, options?: { local?: boolean }): Promise<void>;
    removeAndPersist(source: string, options?: { local?: boolean }): Promise<boolean>;
    update(source?: string): Promise<void>;
    listConfiguredPackages(): ConfiguredPackage[];
    resolveExtensionSources(
      sources: string[],
      options?: { local?: boolean; temporary?: boolean },
    ): Promise<ResolvedPaths>;
    addSourceToSettings(source: string, options?: { local?: boolean }): boolean;
    removeSourceFromSettings(source: string, options?: { local?: boolean }): boolean;
    setProgressCallback(callback: ProgressCallback | undefined): void;
    getInstalledPath(source: string, scope: "user" | "project"): string | undefined;
  }

  type SourceScope = "user" | "project" | "temporary";

  type DefaultPackageManager = (typeof DefaultPackageManagerClass)["prototype"];
}

export type { packageManagerTypes as default };
