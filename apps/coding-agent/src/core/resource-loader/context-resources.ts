import config from "../../config.ts";
import pathsModule from "../../utils/paths.ts";
import defaultResourceLoaderHelpers from "../default-resource-loader-helpers.ts";
import type DefaultResourceLoader from "../default-resource-loader.ts";
import platformModule from "../platform/index.ts";
import resourceLoader from "../resource-loader.ts";
import type resourceLoaderTypes from "../resource-loader.types.ts";

const { join } = platformModule;
const { exists } = platformModule.files;
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

  private discoverPromptFile(name: string): Promise<string | undefined> {
    const projectPath = join(this.owner.environment.cwd, CONFIG_DIR_NAME, name);
    const globalPath = join(this.owner.environment.agentDir, name);
    const project = this.owner.environment.settingsManager.isProjectTrusted()
      ? exists(projectPath)
      : Promise.resolve(false);
    return Promise.all([project, exists(globalPath)]).then(([inProject, inGlobal]) => {
      if (inProject) return projectPath;
      return inGlobal ? globalPath : undefined;
    });
  }

  discoverSystemPromptFile(): Promise<string | undefined> {
    return this.discoverPromptFile("SYSTEM.md");
  }

  discoverAppendSystemPromptFile(): Promise<string | undefined> {
    return this.discoverPromptFile("APPEND_SYSTEM.md");
  }

  configure(options: resourceLoaderTypes.DefaultResourceLoaderOptions): void {
    this.noContextFiles = options.noContextFiles ?? false;
    this.systemPromptSource = options.systemPrompt;
    this.appendSystemPromptSource = options.appendSystemPrompt;
    this.agentsFilesOverride = options.agentsFilesOverride;
    this.systemPromptOverride = options.systemPromptOverride;
    this.appendSystemPromptOverride = options.appendSystemPromptOverride;
  }

  reload(): Promise<void> {
    return Promise.all([
      this.reloadAgentsFiles(),
      this.reloadSystemPrompt(),
      this.reloadAppendSystemPrompt(),
    ]).then(() => undefined);
  }

  private reloadAgentsFiles(): Promise<void> {
    const loaded = this.noContextFiles
      ? Promise.resolve([])
      : loadProjectContextFiles({
          agentDir: this.owner.environment.agentDir,
          cwd: this.owner.environment.cwd,
        });
    return loaded.then((files) => {
      const agentsFiles = { agentsFiles: files };
      const resolved =
        this.agentsFilesOverride === undefined
          ? agentsFiles
          : this.agentsFilesOverride(agentsFiles);
      this.agentsFiles = resolved.agentsFiles;
      return undefined;
    });
  }

  private reloadSystemPrompt(): Promise<void> {
    const source =
      this.systemPromptSource === undefined
        ? this.discoverSystemPromptFile()
        : Promise.resolve(this.systemPromptSource);
    return source.then((resolvedSource) =>
      Promise.all([
        resolvePromptInput(resolvedSource, "system prompt"),
        sourcePathOf(resolvedSource),
      ]).then(([basePrompt, sourcePath]) => {
        this.systemPrompt =
          this.systemPromptOverride === undefined
            ? basePrompt
            : this.systemPromptOverride(basePrompt);
        this.systemPromptSourcePath = sourcePath;
        return undefined;
      }),
    );
  }

  private reloadAppendSystemPrompt(): Promise<void> {
    const sources =
      this.appendSystemPromptSource === undefined
        ? this.discoverAppendSystemPromptFile().then((discovered) =>
            discovered !== undefined && discovered !== "" ? [discovered] : [],
          )
        : Promise.resolve(this.appendSystemPromptSource);
    return sources.then((resolvedSources) =>
      Promise.all([
        Promise.all(
          resolvedSources.map((source) => resolvePromptInput(source, "append system prompt")),
        ),
        Promise.all(resolvedSources.map(sourcePathOf)),
      ]).then(([prompts, sourcePaths]) => {
        const baseAppend = prompts.filter((prompt): prompt is string => prompt !== undefined);
        this.appendSystemPrompt =
          this.appendSystemPromptOverride === undefined
            ? baseAppend
            : this.appendSystemPromptOverride(baseAppend);
        this.appendSystemPromptSourcePaths = sourcePaths.filter(
          (path): path is string => path !== undefined,
        );
        return undefined;
      }),
    );
  }
}

function sourcePathOf(source: string | undefined): Promise<string | undefined> {
  if (source === undefined || source === "") return Promise.resolve(undefined);
  return exists(source).then((found) => (found ? resolvePath(source) : undefined));
}
