import config from "../../config.ts";
import pathsModule from "../../utils/paths.ts";
import defaultResourceLoaderHelpers from "../default-resource-loader-helpers.ts";
import type DefaultResourceLoader from "../default-resource-loader.ts";
import platformModule from "../platform/index.ts";
import nodeFs from "../platform/node/fs.ts";
import resourceLoader from "../resource-loader.ts";
import type resourceLoaderTypes from "../resource-loader.types.ts";

const { existsSync } = nodeFs;
const { join } = platformModule;
const { CONFIG_DIR_NAME } = config;
const { resolvePath } = pathsModule;
const { resolvePromptInput } = defaultResourceLoaderHelpers;
const { loadProjectContextFiles } = resourceLoader;

export default class ContextResources {
  private readonly owner: DefaultResourceLoader;

  constructor(owner: DefaultResourceLoader) {
    this.owner = owner;
  }

  noContextFiles = false;

  systemPromptSource?: string | undefined;

  appendSystemPromptSource?: string[] | undefined;

  agentsFilesOverride!: resourceLoaderTypes.DefaultResourceLoaderOptions["agentsFilesOverride"];

  systemPromptOverride!: resourceLoaderTypes.DefaultResourceLoaderOptions["systemPromptOverride"];

  appendSystemPromptOverride!: resourceLoaderTypes.DefaultResourceLoaderOptions["appendSystemPromptOverride"];

  agentsFiles: Array<{ path: string; content: string }> = [];

  systemPrompt?: string | undefined;

  systemPromptSourcePath?: string | undefined;

  appendSystemPrompt: string[] = [];

  appendSystemPromptSourcePaths: string[] = [];

  discoverSystemPromptFile(): string | undefined {
    const projectPath = join(this.owner.environment.cwd, CONFIG_DIR_NAME, "SYSTEM.md");
    if (this.owner.environment.settingsManager.isProjectTrusted() && existsSync(projectPath)) {
      return projectPath;
    }

    const globalPath = join(this.owner.environment.agentDir, "SYSTEM.md");
    if (existsSync(globalPath)) {
      return globalPath;
    }

    return undefined;
  }

  discoverAppendSystemPromptFile(): string | undefined {
    const projectPath = join(this.owner.environment.cwd, CONFIG_DIR_NAME, "APPEND_SYSTEM.md");
    if (this.owner.environment.settingsManager.isProjectTrusted() && existsSync(projectPath)) {
      return projectPath;
    }

    const globalPath = join(this.owner.environment.agentDir, "APPEND_SYSTEM.md");
    if (existsSync(globalPath)) {
      return globalPath;
    }

    return undefined;
  }

  configure(options: resourceLoaderTypes.DefaultResourceLoaderOptions): void {
    this.noContextFiles = options.noContextFiles ?? false;
    this.systemPromptSource = options.systemPrompt;
    this.appendSystemPromptSource = options.appendSystemPrompt;
    this.agentsFilesOverride = options.agentsFilesOverride;
    this.systemPromptOverride = options.systemPromptOverride;
    this.appendSystemPromptOverride = options.appendSystemPromptOverride;
  }

  reload(): void {
    this.reloadAgentsFiles();
    this.reloadSystemPrompt();
    this.reloadAppendSystemPrompt();
  }

  private reloadAgentsFiles(): void {
    const agentsFiles = {
      agentsFiles: this.noContextFiles
        ? []
        : loadProjectContextFiles({
            agentDir: this.owner.environment.agentDir,
            cwd: this.owner.environment.cwd,
          }),
    };
    const resolved =
      this.agentsFilesOverride === undefined ? agentsFiles : this.agentsFilesOverride(agentsFiles);
    this.agentsFiles = resolved.agentsFiles;
  }

  private reloadSystemPrompt(): void {
    const source = this.systemPromptSource ?? this.discoverSystemPromptFile();
    const basePrompt = resolvePromptInput(source, "system prompt");
    this.systemPrompt =
      this.systemPromptOverride === undefined ? basePrompt : this.systemPromptOverride(basePrompt);
    this.systemPromptSourcePath =
      source !== undefined && source !== "" && existsSync(source) ? resolvePath(source) : undefined;
  }

  private reloadAppendSystemPrompt(): void {
    const discovered = this.discoverAppendSystemPromptFile();
    const sources =
      this.appendSystemPromptSource ??
      (discovered !== undefined && discovered !== "" ? [discovered] : []);
    const baseAppend = sources
      .map((source) => resolvePromptInput(source, "append system prompt"))
      .filter((prompt): prompt is string => prompt !== undefined);
    this.appendSystemPrompt =
      this.appendSystemPromptOverride === undefined
        ? baseAppend
        : this.appendSystemPromptOverride(baseAppend);
    this.appendSystemPromptSourcePaths = sources
      .filter((source) => existsSync(source))
      .map((source) => resolvePath(source));
  }
}
