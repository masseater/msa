import * as Effect from "effect/Effect";

import awaitingModule from "./awaiting.ts";
import type resourceLoaderTypes from "./resource-loader.types.ts";
import ContextResources from "./resource-loader/context-resources.ts";
import ExtensionResources from "./resource-loader/extension-resources.ts";
import PromptResources from "./resource-loader/prompt-resources.ts";
import ResourceDiscovery from "./resource-loader/resource-discovery.ts";
import ResourceEnvironment from "./resource-loader/resource-environment.ts";
import SkillResources from "./resource-loader/skill-resources.ts";
import ThemeResources from "./resource-loader/theme-resources.ts";

const { awaitingWith } = awaitingModule;

type Loader = resourceLoaderTypes.ResourceLoader;

export default class DefaultResourceLoader implements Loader {
  readonly environment: ResourceEnvironment;
  readonly discovery: ResourceDiscovery;
  readonly extensions: ExtensionResources;
  readonly skills: SkillResources;
  readonly prompts: PromptResources;
  readonly themes: ThemeResources;
  readonly context: ContextResources;

  private readonly options: resourceLoaderTypes.DefaultResourceLoaderOptions;

  loaded = false;

  fork(): DefaultResourceLoader {
    return new DefaultResourceLoader(this.options);
  }

  getExtensions(): ReturnType<Loader["getExtensions"]> {
    return this.extensions.extensionsResult;
  }

  getSkills(): ReturnType<Loader["getSkills"]> {
    return { diagnostics: this.skills.skillDiagnostics, skills: this.skills.skills };
  }

  getPrompts(): ReturnType<Loader["getPrompts"]> {
    return { diagnostics: this.prompts.promptDiagnostics, prompts: this.prompts.prompts };
  }

  getThemes(): ReturnType<Loader["getThemes"]> {
    return { diagnostics: this.themes.themeDiagnostics, themes: this.themes.themes };
  }

  getAgentsFiles(): ReturnType<Loader["getAgentsFiles"]> {
    return { agentsFiles: this.context.agentsFiles };
  }

  getSystemPrompt(): string | undefined {
    return this.context.systemPrompt;
  }

  getSystemPromptSource(): { path: string } | undefined {
    const path = this.context.systemPromptSourcePath;
    return path !== undefined && path !== "" ? { path } : undefined;
  }

  getAppendSystemPrompt(): string[] {
    return this.context.appendSystemPrompt;
  }

  getAppendSystemPromptSources(): Array<{ path: string }> {
    return this.context.appendSystemPromptSourcePaths.map((path) => ({ path }));
  }

  extendResources(paths: resourceLoaderTypes.ResourceExtensionPaths): void {
    this.skills.extend(this.extensions.normalizeExtensionPaths(paths.skillPaths ?? []));
    this.prompts.extend(this.extensions.normalizeExtensionPaths(paths.promptPaths ?? []));
    this.themes.extend(this.extensions.normalizeExtensionPaths(paths.themePaths ?? []));
  }

  reload(options?: resourceLoaderTypes.ResourceLoaderReloadOptions): Promise<void> {
    return Effect.runPromise(
      awaitingWith(function* () {
        const plan = yield* this.discovery.discover(options);
        yield* this.extensions.reload(plan);
        this.skills.reload(plan);
        this.prompts.reload(plan);
        this.themes.reload(plan);
        this.context.reload();
        this.loaded = true;
      }, this),
    );
  }

  constructor(options: resourceLoaderTypes.DefaultResourceLoaderOptions) {
    this.options = options;
    this.environment = new ResourceEnvironment(options);
    this.discovery = new ResourceDiscovery(this);
    this.extensions = new ExtensionResources(this);
    this.skills = new SkillResources(this);
    this.prompts = new PromptResources(this);
    this.themes = new ThemeResources(this);
    this.context = new ContextResources(this);
    this.extensions.configure(options);
    this.skills.configure(options);
    this.prompts.configure(options);
    this.themes.configure(options);
    this.context.configure(options);
  }
}
