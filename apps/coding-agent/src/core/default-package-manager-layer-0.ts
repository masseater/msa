import pathsModule from "../utils/paths.ts";
import type defaultPackageManagerInternalTypes from "./default-package-manager-internal.types.ts";
import type packageManagerTypes from "./package-manager.types.ts";
import type settingsManagerTypes from "./settings-manager.types.ts";

const { resolvePath } = pathsModule;

export default abstract class DefaultPackageManagerLayer0 {
  constructor(options: defaultPackageManagerInternalTypes.PackageManagerOptions) {
    this.cwd = resolvePath(options.cwd);
    this.agentDir = resolvePath(options.agentDir);
    this.settingsManager = options.settingsManager;
    this.builtinExtensions = options.builtinExtensions ?? [];
  }

  protected cwd!: string;
  protected agentDir!: string;
  protected settingsManager!: settingsManagerTypes.SettingsManager;
  protected builtinExtensions!: string[];
  protected globalNpmRoot!: string | undefined;
  protected globalNpmRootCommandKey!: string | undefined;
  protected progressCallback!: packageManagerTypes.ProgressCallback | undefined;
}
