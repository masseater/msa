import type packageManagerTypes from "../core/package-manager.types.ts";
import type settingsManagerTypes from "../core/settings-manager.types.ts";
import type trustManagerTypes from "../core/trust-manager.types.ts";

declare namespace codingAgentSettingsKitTypes {
  type PackageManager = packageManagerTypes.PackageManager;
  type PathMetadata = packageManagerTypes.PathMetadata;
  type ProgressCallback = packageManagerTypes.ProgressCallback;
  type ProgressEvent = packageManagerTypes.ProgressEvent;
  type ResolvedPaths = packageManagerTypes.ResolvedPaths;
  type ResolvedResource = packageManagerTypes.ResolvedResource;
  type DefaultPackageManager = packageManagerTypes.DefaultPackageManager;
  type CacheWarmingMode = settingsManagerTypes.CacheWarmingMode;
  type CompactionModelOverride = settingsManagerTypes.CompactionModelOverride;
  type CompactionSettings = settingsManagerTypes.CompactionSettings;
  type DefaultProjectTrust = settingsManagerTypes.DefaultProjectTrust;
  type FullscreenExitOutput = settingsManagerTypes.FullscreenExitOutput;
  type ImageSettings = settingsManagerTypes.ImageSettings;
  type PackageSource = settingsManagerTypes.PackageSource;
  type QuietStartup = settingsManagerTypes.QuietStartup;
  type RetrySettings = settingsManagerTypes.RetrySettings;
  type SettingsManager = settingsManagerTypes.SettingsManager;
  type SettingsManagerCreateOptions = settingsManagerTypes.SettingsManagerCreateOptions;
  type TuiMode = settingsManagerTypes.TuiMode;
  type ProjectTrustDecision = trustManagerTypes.ProjectTrustDecision;
  type ProjectTrustStore = trustManagerTypes.ProjectTrustStore;
  type ProjectTrustStoreEntry = trustManagerTypes.ProjectTrustStoreEntry;
  type ProjectTrustUpdate = trustManagerTypes.ProjectTrustUpdate;
}

export type { codingAgentSettingsKitTypes as default };
