import pathsModule from "../utils/paths.ts";
import type packageManagerTypes from "./package-manager.types.ts";
import ConfiguredPackages from "./package-manager/configured-packages.ts";
import GitPackages from "./package-manager/git.ts";
import NpmPackages from "./package-manager/npm.ts";
import PackageOperations from "./package-manager/operations.ts";
import PackageResolution from "./package-manager/package-resolution.ts";
import PackageSources from "./package-manager/package-sources.ts";
import PackageProgress from "./package-manager/progress.ts";
import PackageResources from "./package-manager/resources.ts";

const { resolvePath } = pathsModule;

type Options = packageManagerTypes.PackageManagerOptions;

export default class DefaultPackageManager implements packageManagerTypes.PackageManager {
  readonly cwd: string;
  readonly agentDir: string;
  readonly settingsManager: Options["settingsManager"];
  readonly builtinExtensions: string[];
  readonly npm: NpmPackages;
  readonly git: GitPackages;
  readonly resources: PackageResources;
  readonly sources: PackageSources;
  readonly configured: ConfiguredPackages;
  readonly resolution: PackageResolution;
  readonly operations: PackageOperations;
  readonly progress = new PackageProgress();

  constructor(options: Options) {
    this.cwd = resolvePath(options.cwd);
    this.agentDir = resolvePath(options.agentDir);
    this.settingsManager = options.settingsManager;
    this.builtinExtensions = options.builtinExtensions ?? [];
    this.npm = new NpmPackages(this);
    this.git = new GitPackages(this);
    this.resources = new PackageResources(this);
    this.sources = new PackageSources(this);
    this.configured = new ConfiguredPackages(this);
    this.resolution = new PackageResolution(this);
    this.operations = new PackageOperations(this);
  }
}
