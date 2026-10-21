import pathsModule from "../../utils/paths.ts";
import DefaultPackageManager from "../default-package-manager.ts";
import type defaultResourceLoaderInternalTypes from "../default-resource-loader-internal.types.ts";
import eventBusModule from "../event-bus.ts";
import type extensionsTypesTypes from "../extensions/types.types.ts";
import resourceLoader from "../resource-loader.ts";
import type resourceLoaderTypes from "../resource-loader.types.ts";
import SettingsManager from "../settings-manager.ts";
import ResourcePaths from "./resource-paths.ts";

const { resolvePath } = pathsModule;
const { createEventBus } = eventBusModule;
const { isBuiltinExtension } = resourceLoader;

type Options = resourceLoaderTypes.DefaultResourceLoaderOptions;

export default class ResourceEnvironment {
  readonly cwd: string;

  readonly agentDir: string;

  readonly settingsManager: NonNullable<Options["settingsManager"]>;

  readonly eventBus: NonNullable<Options["eventBus"]>;

  readonly extensionFactories: extensionsTypesTypes.InlineExtension[];

  readonly builtinExtensions: Map<string, defaultResourceLoaderInternalTypes.BuiltinExtension>;

  readonly packageManager: DefaultPackageManager;

  readonly paths: ResourcePaths;

  constructor(options: Options) {
    this.cwd = resolvePath(options.cwd);
    this.agentDir = resolvePath(options.agentDir);
    this.settingsManager =
      options.settingsManager ?? SettingsManager.unloaded(this.cwd, this.agentDir);
    this.eventBus = options.eventBus ?? createEventBus();
    const factories = options.extensionFactories ?? [];
    this.extensionFactories = factories.filter((input) => !isBuiltinExtension(input));
    this.builtinExtensions = new Map(
      factories.filter(isBuiltinExtension).map((input) => [input.name, input]),
    );
    this.packageManager = new DefaultPackageManager({
      agentDir: this.agentDir,
      builtinExtensions: [...this.builtinExtensions.keys()],
      cwd: this.cwd,
      settingsManager: this.settingsManager,
    });
    this.paths = new ResourcePaths(this);
  }
}
