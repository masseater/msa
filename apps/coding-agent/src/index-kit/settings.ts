import config from "../config.ts";
import DefaultPackageManager from "../core/default-package-manager.ts";
import ProjectTrustStore from "../core/project-trust-store.ts";
import SettingsManager from "../core/settings-manager.ts";
import trustManager from "../core/trust-manager.ts";

const settingsKit: {
  readonly CONFIG_DIR_NAME: typeof config.CONFIG_DIR_NAME;
  readonly DefaultPackageManager: typeof DefaultPackageManager;
  readonly ProjectTrustStore: typeof ProjectTrustStore;
  readonly SettingsManager: typeof SettingsManager;
  readonly VERSION: typeof config.VERSION;
  readonly getAgentDir: typeof config.getAgentDir;
  readonly getDocsPath: typeof config.getDocsPath;
  readonly getExamplesPath: typeof config.getExamplesPath;
  readonly getPackageDir: typeof config.getPackageDir;
  readonly getReadmePath: typeof config.getReadmePath;
  readonly hasTrustRequiringProjectResources: typeof trustManager.hasTrustRequiringProjectResources;
} = {
  CONFIG_DIR_NAME: config.CONFIG_DIR_NAME,
  DefaultPackageManager,
  ProjectTrustStore,
  SettingsManager,
  VERSION: config.VERSION,
  getAgentDir: config.getAgentDir,
  getDocsPath: config.getDocsPath,
  getExamplesPath: config.getExamplesPath,
  getPackageDir: config.getPackageDir,
  getReadmePath: config.getReadmePath,
  hasTrustRequiringProjectResources: trustManager.hasTrustRequiringProjectResources,
};

export default settingsKit;
