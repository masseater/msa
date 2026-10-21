import awaitingModule from "../awaiting.ts";
import type defaultResourceLoaderInternalTypes from "../default-resource-loader-internal.types.ts";
import type DefaultResourceLoader from "../default-resource-loader.ts";
import type diagnosticsTypes from "../diagnostics.ts";
import type packageManagerTypes from "../package-manager.types.ts";
import promptTemplates from "../prompt-templates.ts";
import type promptTemplatesTypes from "../prompt-templates.types.ts";
import type resourceLoaderTypes from "../resource-loader.types.ts";
import sourceInfoModule from "../source-info.ts";
import type sourceInfoTypes from "../source-info.types.ts";

const { loadPromptTemplates } = promptTemplates;
const { awaited } = awaitingModule;

const { createSourceInfo } = sourceInfoModule;

export default class PromptResources {
  private readonly owner: DefaultResourceLoader;

  constructor(owner: DefaultResourceLoader) {
    this.owner = owner;
  }

  additionalPromptTemplatePaths: string[] = [];

  noPromptTemplates = false;

  promptsOverride!: resourceLoaderTypes.DefaultResourceLoaderOptions["promptsOverride"];

  prompts: promptTemplatesTypes.PromptTemplate[] = [];

  promptDiagnostics: diagnosticsTypes.ResourceDiagnostic[] = [];

  extensionPromptSourceInfos = new Map<string, sourceInfoTypes.SourceInfo>();

  lastPromptPaths: string[] = [];

  private dedupePrompts(prompts: promptTemplatesTypes.PromptTemplate[]): {
    prompts: promptTemplatesTypes.PromptTemplate[];
    diagnostics: diagnosticsTypes.ResourceDiagnostic[];
  } {
    const seen = new Map<string, promptTemplatesTypes.PromptTemplate>();
    const diagnostics: diagnosticsTypes.ResourceDiagnostic[] = [];

    for (const prompt of prompts) {
      const existing = seen.get(prompt.name);
      if (existing === undefined) {
        seen.set(prompt.name, prompt);
      } else {
        diagnostics.push({
          collision: {
            loserPath: prompt.filePath,
            name: prompt.name,
            resourceType: "prompt",
            winnerPath: existing.filePath,
          },
          message: `name "/${prompt.name}" collision`,
          path: prompt.filePath,
          type: "collision",
        });
      }
    }

    return { diagnostics, prompts: Array.from(seen.values()) };
  }

  private loadPrompts(promptPaths: string[]): Promise<{
    prompts: promptTemplatesTypes.PromptTemplate[];
    diagnostics: diagnosticsTypes.ResourceDiagnostic[];
  }> {
    if (this.noPromptTemplates && promptPaths.length === 0)
      return Promise.resolve({ diagnostics: [], prompts: [] });
    return loadPromptTemplates({
      agentDir: this.owner.environment.agentDir,
      cwd: this.owner.environment.cwd,
      includeDefaults: false,
      promptPaths,
    }).then((loaded) => {
      const deduped = this.dedupePrompts(loaded.templates);
      return {
        diagnostics: [...loaded.diagnostics, ...deduped.diagnostics],
        prompts: deduped.prompts,
      };
    });
  }

  updatePromptsFromPaths(
    promptPaths: string[],
    metadataByPath?: Map<string, packageManagerTypes.PathMetadata>,
  ): Promise<void> {
    return this.loadPrompts(promptPaths)
      .then((promptsResult) =>
        this.promptsOverride === undefined ? promptsResult : this.promptsOverride(promptsResult),
      )
      .then((resolvedPrompts) =>
        Promise.all(
          resolvedPrompts.prompts.map((prompt) => this.withSourceInfo(prompt, metadataByPath)),
        ).then((prompts) => {
          this.prompts = prompts;
          this.promptDiagnostics = resolvedPrompts.diagnostics;
          return undefined;
        }),
      );
  }

  private withSourceInfo(
    prompt: promptTemplatesTypes.PromptTemplate,
    metadataByPath: Map<string, packageManagerTypes.PathMetadata> | undefined,
  ): Promise<promptTemplatesTypes.PromptTemplate> {
    const { paths } = this.owner.environment;
    const sourceInfo =
      paths.findSourceInfoForPath(
        prompt.filePath,
        this.extensionPromptSourceInfos,
        metadataByPath,
      ) ?? prompt.sourceInfo;
    return (
      sourceInfo === undefined
        ? paths.getDefaultSourceInfoForPath(prompt.filePath)
        : Promise.resolve(sourceInfo)
    ).then((resolved) => ({ ...prompt, sourceInfo: resolved }));
  }

  configure(options: resourceLoaderTypes.DefaultResourceLoaderOptions): void {
    this.additionalPromptTemplatePaths = options.additionalPromptTemplatePaths ?? [];
    this.noPromptTemplates = options.noPromptTemplates ?? false;
    this.promptsOverride = options.promptsOverride;
  }

  *reload(plan: defaultResourceLoaderInternalTypes.ResourcePlan) {
    const { paths } = this.owner.environment;
    const { cli, configured } = plan.prompts;
    const promptPaths = yield* awaited(
      this.noPromptTemplates
        ? paths.mergePaths(cli, this.additionalPromptTemplatePaths)
        : paths.mergePaths([...cli, ...configured], this.additionalPromptTemplatePaths),
    );
    this.lastPromptPaths = promptPaths;
    yield* awaited(this.updatePromptsFromPaths(promptPaths, plan.metadataByPath));
    for (const resolved of yield* awaited(
      paths.missingPaths(this.additionalPromptTemplatePaths, true),
    )) {
      if (this.promptDiagnostics.some((d) => d.path === resolved)) continue;
      this.promptDiagnostics.push({
        message: "Prompt template path does not exist",
        path: resolved,
        type: "error",
      });
    }
  }

  *extend(entries: Array<{ path: string; metadata: packageManagerTypes.PathMetadata }>) {
    for (const entry of entries) {
      this.extensionPromptSourceInfos.set(entry.path, createSourceInfo(entry.path, entry.metadata));
    }
    if (entries.length === 0) return;
    this.lastPromptPaths = yield* awaited(
      this.owner.environment.paths.mergePaths(
        this.lastPromptPaths,
        entries.map((entry) => entry.path),
      ),
    );
    yield* awaited(
      this.updatePromptsFromPaths(
        this.lastPromptPaths,
        this.owner.environment.paths.resourceMetadataByPath,
      ),
    );
  }
}
