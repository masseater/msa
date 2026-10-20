import { existsSync, readFileSync, readdirSync, statSync } from "node:fs";

import chalk from "chalk";
import * as Effect from "effect/Effect";

import { CONFIG_DIR_NAME } from "../config.ts";
import { type Theme, loadThemeFromPath } from "../modes/interactive/theme/theme.ts";
import { awaited, awaitingWith, performed } from "./awaiting.ts";
import type { ResourceDiagnostic } from "./diagnostics.ts";
import { basename, dirname, join, resolve, sep } from "./platform-node.ts";

export type { ResourceCollision, ResourceDiagnostic } from "./diagnostics.ts";

import tui from "@msa/tui";
import type tuiTypes from "@msa/tui/index.types";

import { canonicalizePath, isLocalPath, resolvePath } from "../utils/paths.ts";
import { stripBom } from "../utils/text.ts";
import { createEventBus, type EventBus } from "./event-bus.ts";
import {
  clearExtensionCache,
  createExtensionRuntime,
  loadExtensionFromFactory,
  loadExtensionsCached,
} from "./extensions/loader.ts";
import type {
  Extension,
  ExtensionFactory,
  ExtensionRuntime,
  InlineExtension,
  LoadExtensionsResult,
} from "./extensions/types.ts";
import { findGitPaths } from "./footer-data-provider.ts";
import {
  DefaultPackageManager,
  type PathMetadata,
  type ResolvedResource,
} from "./package-manager.ts";
import { writeError } from "./platform.ts";
import type { PromptTemplate } from "./prompt-templates.ts";
import { loadPromptTemplates } from "./prompt-templates.ts";
import { SettingsManager } from "./settings-manager.ts";
import type { Skill } from "./skills.ts";
import { loadSkills } from "./skills.ts";
import {
  BUILTIN_PATH_PREFIX,
  createSourceInfo,
  getSyntheticPathSource,
  isSyntheticPath,
  type SourceInfo,
} from "./source-info.ts";
import { resetTimings } from "./timings.ts";

const { detectCapabilities, getTerminalColorMode } = tui;

export interface ResourceExtensionPaths {
  skillPaths?: Array<{ path: string; metadata: PathMetadata }>;
  promptPaths?: Array<{ path: string; metadata: PathMetadata }>;
  themePaths?: Array<{ path: string; metadata: PathMetadata }>;
}

export interface ResourceLoaderReloadOptions {
  resolveProjectTrust?: (input: { extensionsResult: LoadExtensionsResult }) => Promise<boolean>;
}

const HOST_PROVIDED_EXTENSION_PACKAGES = new Set([
  "@msa/agent-core",
  "@msa/ai",
  "@msa/coding-agent",
  "@msa/tui",
  "@mariozechner/pi-agent-core",
  "@mariozechner/pi-ai",
  "@mariozechner/pi-coding-agent",
  "@mariozechner/pi-tui",
  "@sinclair/typebox",
  "typebox",
]);

function collectExtensionPackageWarnings(
  extensionPaths: string[],
  metadataByPath: Map<string, PathMetadata>,
): Array<{ path: string; warning: string }> {
  const warnings: Array<{ path: string; warning: string }> = [];
  const packageRoots = new Set(
    extensionPaths
      .map((extensionPath) => metadataByPath.get(extensionPath)?.packageRoot)
      .filter((packageRoot): packageRoot is string => packageRoot !== undefined),
  );
  for (const packageRoot of packageRoots) {
    const packageJsonPath = join(packageRoot, "package.json");
    if (!existsSync(packageJsonPath)) continue;
    const manifest = JSON.parse(stripBom(readFileSync(packageJsonPath, "utf-8"))) as {
      dependencies?: unknown;
    };
    if (
      typeof manifest.dependencies !== "object" ||
      manifest.dependencies === null ||
      Array.isArray(manifest.dependencies)
    ) {
      continue;
    }
    const hostDependencies = Object.keys(manifest.dependencies)
      .filter((name) => HOST_PROVIDED_EXTENSION_PACKAGES.has(name))
      .sort();
    if (hostDependencies.length === 0) continue;
    warnings.push({
      path: packageJsonPath,
      warning: `Host-provided extension packages must be declared in peerDependencies with a "*" range, not dependencies: ${hostDependencies.join(", ")}. Installed copies can bypass the extension loader and create duplicate runtime modules.`,
    });
  }
  return warnings;
}

function mergeExtensionWarnings(
  result: LoadExtensionsResult,
  warnings: Array<{ path: string; warning: string }>,
): void {
  result.warnings = [
    ...new Map(
      [...(result.warnings ?? []), ...warnings].map((warning) => [warning.path, warning]),
    ).values(),
  ];
}

type BuiltinExtension = Exclude<InlineExtension, ExtensionFactory>;

export function isBuiltinExtension(input: InlineExtension): input is BuiltinExtension {
  return typeof input !== "function" && input.builtin === true;
}

function omitReplacedExtensions(
  extensions: Extension[],
  warnings?: Array<{ path: string; warning: string }>,
): Extension[] {
  const names = (extension: Extension) => [
    ...[...extension.tools.keys()].map((name) => `tool:${name}`),
    ...[...extension.commands.keys()].map((name) => `command:${name}`),
    ...[...extension.flags.keys()].map((name) => `flag:${name}`),
  ];
  const taken = new Map(
    extensions
      .filter((extension) => extension.replaceable !== true)
      .flatMap((extension) => names(extension).map((name) => [name, extension] as const)),
  );
  return extensions.filter((extension) => {
    if (extension.replaceable !== true) return true;
    const replacement = names(extension)
      .map((name) => ({ extension: taken.get(name), name }))
      .find(
        (value): value is { name: string; extension: Extension } => value.extension !== undefined,
      );
    if (replacement === undefined) return true;
    if (extension.path.startsWith(BUILTIN_PATH_PREFIX)) {
      const builtinName = extension.path.slice(BUILTIN_PATH_PREFIX.length);
      const [kind, rawName] = replacement.name.split(":", 2);
      const registeredName =
        kind === "command" ? `/${rawName}` : kind === "flag" ? `--${rawName}` : rawName;
      warnings?.push({
        path: extension.path,
        warning: `Extension ${replacement.extension.path} registers ${kind} \`${registeredName}\`, so built-in extension \`${builtinName}\` was not loaded. To use \`${builtinName}\`, run \`msa config\` and make sure it is enabled under Built-in extensions, then disable or remove the existing extension. We recommend only having one or the other loaded at a time.`,
      });
    }
    return false;
  });
}

export interface ResourceLoader {
  getExtensions(): LoadExtensionsResult;
  getSkills(): { skills: Skill[]; diagnostics: ResourceDiagnostic[] };
  getPrompts(): { prompts: PromptTemplate[]; diagnostics: ResourceDiagnostic[] };
  getThemes(): { themes: Theme[]; diagnostics: ResourceDiagnostic[] };
  getAgentsFiles(): { agentsFiles: Array<{ path: string; content: string }> };
  getSystemPrompt(): string | undefined;
  getSystemPromptSource(): { path: string } | undefined;
  getAppendSystemPrompt(): string[];
  getAppendSystemPromptSources(): Array<{ path: string }>;
  extendResources(paths: ResourceExtensionPaths): void;
  reload(options?: ResourceLoaderReloadOptions): Promise<void>;
}

function resolvePromptInput(input: string | undefined, description: string): string | undefined {
  if (input === undefined || input === "") {
    return undefined;
  }

  if (existsSync(input)) {
    try {
      return stripBom(readFileSync(input, "utf-8"));
    } catch (error) {
      writeError(chalk.yellow(`Warning: Could not read ${description} file ${input}: ${error}`));
      return input;
    }
  }

  return input;
}

function loadContextFileFromDir(dir: string): { path: string; content: string } | null {
  const candidates = ["AGENTS.override.md", "AGENTS.md", "AGENTS.MD", "CLAUDE.md", "CLAUDE.MD"];
  for (const filename of candidates) {
    const filePath = join(dir, filename);
    if (existsSync(filePath)) {
      try {
        if (!statSync(filePath).isFile()) {
          continue;
        }
        return {
          content: stripBom(readFileSync(filePath, "utf-8")),
          path: filePath,
        };
      } catch (error) {
        writeError(chalk.yellow(`Warning: Could not read ${filePath}: ${error}`));
      }
    }
  }
  return null;
}

function findShadowedContextFile(cwd: string): string | undefined {
  const gitPaths = findGitPaths(cwd);
  if (gitPaths === null) return undefined;
  const commonGitDir = canonicalizePath(gitPaths.commonGitDir);
  const worktreeRoot = canonicalizePath(gitPaths.repoDir);
  const mainRepoRoot = dirname(commonGitDir);
  if (!worktreeRoot.startsWith(`${mainRepoRoot}${sep}`)) return undefined;
  if (canonicalizePath(join(mainRepoRoot, ".git")) !== commonGitDir) return undefined;
  const worktreeContextFile = loadContextFileFromDir(worktreeRoot);
  return worktreeContextFile === null
    ? undefined
    : join(mainRepoRoot, basename(worktreeContextFile.path));
}

export function loadProjectContextFiles(options: {
  cwd: string;
  agentDir: string;
}): Array<{ path: string; content: string }> {
  const resolvedCwd = resolvePath(options.cwd);
  const resolvedAgentDir = resolvePath(options.agentDir);

  const contextFiles: Array<{ path: string; content: string }> = [];
  const seenPaths = new Set<string>();

  const globalContext = loadContextFileFromDir(resolvedAgentDir);
  if (globalContext !== null) {
    contextFiles.push(globalContext);
    seenPaths.add(globalContext.path);
  }

  const ancestorContextFiles: Array<{ path: string; content: string }> = [];

  const shadowedContextFile = findShadowedContextFile(resolvedCwd);
  let currentDir = resolvedCwd;

  while (true) {
    const contextFile = loadContextFileFromDir(currentDir);
    const isShadowed =
      shadowedContextFile !== undefined &&
      contextFile !== null &&
      join(canonicalizePath(currentDir), basename(contextFile.path)) === shadowedContextFile;
    if (contextFile !== null && !isShadowed && !seenPaths.has(contextFile.path)) {
      ancestorContextFiles.unshift(contextFile);
      seenPaths.add(contextFile.path);
    }

    const parentDir = dirname(currentDir);
    if (parentDir === currentDir) break;
    currentDir = parentDir;
  }

  contextFiles.push(...ancestorContextFiles);

  return contextFiles;
}

export interface DefaultResourceLoaderOptions {
  cwd: string;
  agentDir: string;
  settingsManager?: SettingsManager | undefined;
  eventBus?: EventBus | undefined;
  additionalExtensionPaths?: string[] | undefined;
  additionalSkillPaths?: string[] | undefined;
  additionalPromptTemplatePaths?: string[] | undefined;
  additionalThemePaths?: string[] | undefined;
  extensionFactories?: InlineExtension[] | undefined;
  noExtensions?: boolean | undefined;
  disabledBuiltinExtensions?: string[] | undefined;
  noSkills?: boolean | undefined;
  noPromptTemplates?: boolean | undefined;
  noThemes?: boolean | undefined;
  noContextFiles?: boolean | undefined;
  systemPrompt?: string | undefined;
  appendSystemPrompt?: string[] | undefined;
  extensionsOverride?: ((base: LoadExtensionsResult) => LoadExtensionsResult) | undefined;
  skillsOverride?: (base: { skills: Skill[]; diagnostics: ResourceDiagnostic[] }) => {
    skills: Skill[];
    diagnostics: ResourceDiagnostic[];
  };
  promptsOverride?: (base: { prompts: PromptTemplate[]; diagnostics: ResourceDiagnostic[] }) => {
    prompts: PromptTemplate[];
    diagnostics: ResourceDiagnostic[];
  };
  themesOverride?: (base: { themes: Theme[]; diagnostics: ResourceDiagnostic[] }) => {
    themes: Theme[];
    diagnostics: ResourceDiagnostic[];
  };
  agentsFilesOverride?: (base: { agentsFiles: Array<{ path: string; content: string }> }) => {
    agentsFiles: Array<{ path: string; content: string }>;
  };
  systemPromptOverride?: (base: string | undefined) => string | undefined;
  appendSystemPromptOverride?: ((base: string[]) => string[]) | undefined;
}

export class DefaultResourceLoader implements ResourceLoader {
  private readonly options: DefaultResourceLoaderOptions;
  private cwd: string;
  private agentDir: string;
  private settingsManager: SettingsManager;
  private eventBus: EventBus;
  private packageManager: DefaultPackageManager;
  private additionalExtensionPaths: string[];
  private additionalSkillPaths: string[];
  private additionalPromptTemplatePaths: string[];
  private additionalThemePaths: string[];
  private extensionFactories: InlineExtension[];
  private builtinExtensions: Map<string, BuiltinExtension>;
  private noExtensions: boolean;
  private disabledBuiltinExtensions: Set<string>;
  private noSkills: boolean;
  private noPromptTemplates: boolean;
  private noThemes: boolean;
  private noContextFiles: boolean;
  private systemPromptSource?: string | undefined;
  private appendSystemPromptSource?: string[] | undefined;
  private extensionsOverride: DefaultResourceLoaderOptions["extensionsOverride"];
  private skillsOverride: DefaultResourceLoaderOptions["skillsOverride"];
  private promptsOverride: DefaultResourceLoaderOptions["promptsOverride"];
  private themesOverride: DefaultResourceLoaderOptions["themesOverride"];
  private agentsFilesOverride: DefaultResourceLoaderOptions["agentsFilesOverride"];
  private systemPromptOverride: DefaultResourceLoaderOptions["systemPromptOverride"];
  private appendSystemPromptOverride: DefaultResourceLoaderOptions["appendSystemPromptOverride"];

  private extensionsResult: LoadExtensionsResult;
  private skills: Skill[];
  private skillDiagnostics: ResourceDiagnostic[];
  private prompts: PromptTemplate[];
  private promptDiagnostics: ResourceDiagnostic[];
  private themes: Theme[];
  private themeDiagnostics: ResourceDiagnostic[];
  private agentsFiles: Array<{ path: string; content: string }>;
  private systemPrompt?: string | undefined;
  private systemPromptSourcePath?: string | undefined;
  private appendSystemPrompt: string[];
  private appendSystemPromptSourcePaths: string[];
  private lastSkillPaths: string[];
  private extensionSkillSourceInfos: Map<string, SourceInfo>;
  private extensionPromptSourceInfos: Map<string, SourceInfo>;
  private extensionThemeSourceInfos: Map<string, SourceInfo>;
  private resourceMetadataByPath: Map<string, PathMetadata>;
  private lastPromptPaths: string[];
  private lastThemePaths: string[];
  private loaded: boolean;

  fork(): DefaultResourceLoader {
    return new DefaultResourceLoader(this.options);
  }

  constructor(options: DefaultResourceLoaderOptions) {
    this.options = options;
    this.cwd = resolvePath(options.cwd);
    this.agentDir = resolvePath(options.agentDir);
    this.settingsManager =
      options.settingsManager ?? SettingsManager.create(this.cwd, this.agentDir);
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
    this.additionalExtensionPaths = options.additionalExtensionPaths ?? [];
    this.additionalSkillPaths = options.additionalSkillPaths ?? [];
    this.additionalPromptTemplatePaths = options.additionalPromptTemplatePaths ?? [];
    this.additionalThemePaths = options.additionalThemePaths ?? [];
    this.noExtensions = options.noExtensions ?? false;
    this.disabledBuiltinExtensions = new Set(options.disabledBuiltinExtensions);
    this.noSkills = options.noSkills ?? false;
    this.noPromptTemplates = options.noPromptTemplates ?? false;
    this.noThemes = options.noThemes ?? false;
    this.noContextFiles = options.noContextFiles ?? false;
    this.systemPromptSource = options.systemPrompt;
    this.appendSystemPromptSource = options.appendSystemPrompt;
    this.extensionsOverride = options.extensionsOverride;
    this.skillsOverride = options.skillsOverride;
    this.promptsOverride = options.promptsOverride;
    this.themesOverride = options.themesOverride;
    this.agentsFilesOverride = options.agentsFilesOverride;
    this.systemPromptOverride = options.systemPromptOverride;
    this.appendSystemPromptOverride = options.appendSystemPromptOverride;

    this.extensionsResult = { errors: [], extensions: [], runtime: createExtensionRuntime() };
    this.skills = [];
    this.skillDiagnostics = [];
    this.prompts = [];
    this.promptDiagnostics = [];
    this.themes = [];
    this.themeDiagnostics = [];
    this.agentsFiles = [];
    this.appendSystemPrompt = [];
    this.appendSystemPromptSourcePaths = [];
    this.lastSkillPaths = [];
    this.extensionSkillSourceInfos = new Map();
    this.extensionPromptSourceInfos = new Map();
    this.extensionThemeSourceInfos = new Map();
    this.resourceMetadataByPath = new Map();
    this.lastPromptPaths = [];
    this.lastThemePaths = [];
    this.loaded = false;
  }

  getExtensions(): LoadExtensionsResult {
    return this.extensionsResult;
  }

  getSkills(): { skills: Skill[]; diagnostics: ResourceDiagnostic[] } {
    return { diagnostics: this.skillDiagnostics, skills: this.skills };
  }

  getPrompts(): { prompts: PromptTemplate[]; diagnostics: ResourceDiagnostic[] } {
    return { diagnostics: this.promptDiagnostics, prompts: this.prompts };
  }

  getThemes(): { themes: Theme[]; diagnostics: ResourceDiagnostic[] } {
    return { diagnostics: this.themeDiagnostics, themes: this.themes };
  }

  getAgentsFiles(): { agentsFiles: Array<{ path: string; content: string }> } {
    return { agentsFiles: this.agentsFiles };
  }

  getSystemPrompt(): string | undefined {
    return this.systemPrompt;
  }

  getSystemPromptSource(): { path: string } | undefined {
    return this.systemPromptSourcePath !== undefined && this.systemPromptSourcePath !== ""
      ? { path: this.systemPromptSourcePath }
      : undefined;
  }

  getAppendSystemPrompt(): string[] {
    return this.appendSystemPrompt;
  }

  getAppendSystemPromptSources(): Array<{ path: string }> {
    return this.appendSystemPromptSourcePaths.map((path) => ({ path }));
  }

  extendResources(paths: ResourceExtensionPaths): void {
    const skillPaths = this.normalizeExtensionPaths(paths.skillPaths ?? []);
    const promptPaths = this.normalizeExtensionPaths(paths.promptPaths ?? []);
    const themePaths = this.normalizeExtensionPaths(paths.themePaths ?? []);

    for (const entry of skillPaths) {
      this.extensionSkillSourceInfos.set(entry.path, createSourceInfo(entry.path, entry.metadata));
    }
    for (const entry of promptPaths) {
      this.extensionPromptSourceInfos.set(entry.path, createSourceInfo(entry.path, entry.metadata));
    }
    for (const entry of themePaths) {
      this.extensionThemeSourceInfos.set(entry.path, createSourceInfo(entry.path, entry.metadata));
    }

    if (skillPaths.length > 0) {
      this.lastSkillPaths = this.mergePaths(
        this.lastSkillPaths,
        skillPaths.map((entry) => entry.path),
      );
      this.updateSkillsFromPaths(this.lastSkillPaths, this.resourceMetadataByPath);
    }

    if (promptPaths.length > 0) {
      this.lastPromptPaths = this.mergePaths(
        this.lastPromptPaths,
        promptPaths.map((entry) => entry.path),
      );
      this.updatePromptsFromPaths(this.lastPromptPaths, this.resourceMetadataByPath);
    }

    if (themePaths.length > 0) {
      this.lastThemePaths = this.mergePaths(
        this.lastThemePaths,
        themePaths.map((entry) => entry.path),
      );
      this.updateThemesFromPaths(this.lastThemePaths, this.resourceMetadataByPath);
    }
  }

  loadProjectTrustExtensions(): Promise<LoadExtensionsResult> {
    return Effect.runPromise(
      awaitingWith(function* () {
        this.settingsManager.setProjectTrusted(false);
        yield* awaited(this.settingsManager.reload());
        return yield* performed(this.loadCurrentExtensionSet({ includeInlineFactories: true }));
      }, this),
    );
  }

  reload(options?: ResourceLoaderReloadOptions): Promise<void> {
    return Effect.runPromise(
      awaitingWith(function* () {
        resetTimings("extensions");

        if (this.loaded) {
          clearExtensionCache();
        }

        let preTrustExtensions: LoadExtensionsResult | undefined;
        if (options?.resolveProjectTrust !== undefined) {
          preTrustExtensions = yield* awaited(this.loadProjectTrustExtensions());
          const projectTrusted = yield* awaited(
            options.resolveProjectTrust({
              extensionsResult: preTrustExtensions,
            }),
          );
          this.settingsManager.setProjectTrusted(projectTrusted);
        }

        yield* awaited(this.settingsManager.reload());
        const resolvedPaths = yield* awaited(this.packageManager.resolve());
        const cliExtensionPaths = yield* awaited(
          this.packageManager.resolveExtensionSources(this.additionalExtensionPaths, {
            temporary: true,
          }),
        );
        this.resourceMetadataByPath = new Map();
        const metadataByPath = this.resourceMetadataByPath;

        this.extensionSkillSourceInfos = new Map();
        this.extensionPromptSourceInfos = new Map();
        this.extensionThemeSourceInfos = new Map();

        const getEnabledResources = (resources: ResolvedResource[]): ResolvedResource[] => {
          for (const r of resources) {
            if (!metadataByPath.has(r.path)) {
              metadataByPath.set(r.path, r.metadata);
            }
          }
          return resources.filter((r) => r.enabled);
        };

        const getEnabledPaths = (resources: ResolvedResource[]): string[] =>
          getEnabledResources(resources).map((r) => r.path);
        const enabledExtensions = getEnabledPaths(resolvedPaths.extensions);
        const enabledSkillResources = getEnabledResources(resolvedPaths.skills);
        const enabledPrompts = getEnabledPaths(resolvedPaths.prompts);
        const enabledThemes = getEnabledPaths(resolvedPaths.themes);

        const enabledSkills = enabledSkillResources.map((resource) =>
          this.mapSkillPath(resource, metadataByPath),
        );

        for (const r of cliExtensionPaths.extensions) {
          if (!metadataByPath.has(r.path)) {
            metadataByPath.set(r.path, { origin: "top-level", scope: "temporary", source: "cli" });
          }
        }
        for (const r of cliExtensionPaths.skills) {
          if (!metadataByPath.has(r.path)) {
            metadataByPath.set(r.path, { origin: "top-level", scope: "temporary", source: "cli" });
          }
        }

        const cliEnabledExtensions = getEnabledPaths(cliExtensionPaths.extensions);
        const cliEnabledSkills = getEnabledPaths(cliExtensionPaths.skills);
        const cliEnabledPrompts = getEnabledPaths(cliExtensionPaths.prompts);
        const cliEnabledThemes = getEnabledPaths(cliExtensionPaths.themes);

        const extensionPaths = (
          this.noExtensions
            ? cliEnabledExtensions
            : this.mergePaths(cliEnabledExtensions, enabledExtensions)
        ).filter(
          (path) =>
            !path.startsWith(BUILTIN_PATH_PREFIX) ||
            !this.disabledBuiltinExtensions.has(path.slice(BUILTIN_PATH_PREFIX.length)),
        );

        const packageWarnings = collectExtensionPackageWarnings(extensionPaths, metadataByPath);
        const extensionsResult = yield* performed(
          this.loadFinalExtensionSet(extensionPaths, preTrustExtensions),
        );
        mergeExtensionWarnings(extensionsResult, packageWarnings);
        for (const p of this.additionalExtensionPaths) {
          if (isLocalPath(p)) {
            const resolved = this.resolveResourcePath(p);
            if (!existsSync(resolved)) {
              extensionsResult.errors.push({
                error: `Extension path does not exist: ${resolved}`,
                path: resolved,
              });
            }
          }
        }
        this.extensionsResult =
          this.extensionsOverride === undefined
            ? extensionsResult
            : this.extensionsOverride(extensionsResult);
        this.applyExtensionSourceInfo(this.extensionsResult.extensions, metadataByPath);

        const skillPaths = this.noSkills
          ? this.mergePaths(cliEnabledSkills, this.additionalSkillPaths)
          : this.mergePaths([...cliEnabledSkills, ...enabledSkills], this.additionalSkillPaths);

        this.lastSkillPaths = skillPaths;
        this.updateSkillsFromPaths(skillPaths, metadataByPath);
        for (const p of this.additionalSkillPaths) {
          if (isLocalPath(p)) {
            const resolved = this.resolveResourcePath(p);
            if (!existsSync(resolved) && !this.skillDiagnostics.some((d) => d.path === resolved)) {
              this.skillDiagnostics.push({
                message: "Skill path does not exist",
                path: resolved,
                type: "error",
              });
            }
          }
        }

        const promptPaths = this.noPromptTemplates
          ? this.mergePaths(cliEnabledPrompts, this.additionalPromptTemplatePaths)
          : this.mergePaths(
              [...cliEnabledPrompts, ...enabledPrompts],
              this.additionalPromptTemplatePaths,
            );

        this.lastPromptPaths = promptPaths;
        this.updatePromptsFromPaths(promptPaths, metadataByPath);
        for (const p of this.additionalPromptTemplatePaths) {
          if (isLocalPath(p)) {
            const resolved = this.resolveResourcePath(p);
            if (!existsSync(resolved) && !this.promptDiagnostics.some((d) => d.path === resolved)) {
              this.promptDiagnostics.push({
                message: "Prompt template path does not exist",
                path: resolved,
                type: "error",
              });
            }
          }
        }

        const themePaths = this.noThemes
          ? this.mergePaths(cliEnabledThemes, this.additionalThemePaths)
          : this.mergePaths([...cliEnabledThemes, ...enabledThemes], this.additionalThemePaths);

        this.lastThemePaths = themePaths;
        this.updateThemesFromPaths(themePaths, metadataByPath);
        for (const p of this.additionalThemePaths) {
          const resolved = this.resolveResourcePath(p);
          if (!existsSync(resolved) && !this.themeDiagnostics.some((d) => d.path === resolved)) {
            this.themeDiagnostics.push({
              message: "Theme path does not exist",
              path: resolved,
              type: "error",
            });
          }
        }

        const agentsFiles = {
          agentsFiles: this.noContextFiles
            ? []
            : loadProjectContextFiles({
                agentDir: this.agentDir,
                cwd: this.cwd,
              }),
        };
        const resolvedAgentsFiles =
          this.agentsFilesOverride === undefined
            ? agentsFiles
            : this.agentsFilesOverride(agentsFiles);
        this.agentsFiles = resolvedAgentsFiles.agentsFiles;

        const systemPromptSource = this.systemPromptSource ?? this.discoverSystemPromptFile();
        const baseSystemPrompt = resolvePromptInput(systemPromptSource, "system prompt");
        this.systemPrompt =
          this.systemPromptOverride === undefined
            ? baseSystemPrompt
            : this.systemPromptOverride(baseSystemPrompt);
        this.systemPromptSourcePath =
          systemPromptSource !== undefined &&
          systemPromptSource !== "" &&
          existsSync(systemPromptSource)
            ? resolvePath(systemPromptSource)
            : undefined;

        let appendSources = this.appendSystemPromptSource;
        if (appendSources === undefined) {
          const discoveredAppendSystemPromptFile = this.discoverAppendSystemPromptFile();
          appendSources =
            discoveredAppendSystemPromptFile !== undefined &&
            discoveredAppendSystemPromptFile !== ""
              ? [discoveredAppendSystemPromptFile]
              : [];
        }
        const baseAppend = appendSources
          .map((s) => resolvePromptInput(s, "append system prompt"))
          .filter((s): s is string => s !== undefined);
        this.appendSystemPrompt =
          this.appendSystemPromptOverride === undefined
            ? baseAppend
            : this.appendSystemPromptOverride(baseAppend);
        this.appendSystemPromptSourcePaths = appendSources
          .filter((source) => existsSync(source))
          .map((source) => resolvePath(source));
        this.loaded = true;
      }, this),
    );
  }

  private loadCurrentExtensionSet(options: {
    includeInlineFactories: boolean;
  }): Effect.Effect<LoadExtensionsResult> {
    return awaitingWith(function* () {
      const resolvedPaths = yield* awaited(this.packageManager.resolve());
      const cliExtensionPaths = yield* awaited(
        this.packageManager.resolveExtensionSources(this.additionalExtensionPaths, {
          temporary: true,
        }),
      );
      const enabledExtensions = resolvedPaths.extensions
        .filter((r) => r.enabled)
        .map((r) => r.path);
      const cliEnabledExtensions = cliExtensionPaths.extensions
        .filter((r) => r.enabled)
        .map((r) => r.path);
      const extensionPaths = (
        this.noExtensions
          ? cliEnabledExtensions
          : this.mergePaths(cliEnabledExtensions, enabledExtensions)
      ).filter((path) => !path.startsWith(BUILTIN_PATH_PREFIX));
      const metadataByPath = new Map(
        [...resolvedPaths.extensions, ...cliExtensionPaths.extensions].map((resource) => [
          resource.path,
          resource.metadata,
        ]),
      );
      const packageWarnings = collectExtensionPackageWarnings(extensionPaths, metadataByPath);
      const extensionsResult = yield* awaited(
        loadExtensionsCached(extensionPaths, this.cwd, this.eventBus),
      );
      mergeExtensionWarnings(extensionsResult, packageWarnings);
      if (!options.includeInlineFactories) {
        return extensionsResult;
      }

      const inlineExtensions = yield* performed(
        this.loadExtensionFactories(extensionsResult.runtime),
      );
      extensionsResult.extensions.push(...inlineExtensions.extensions);
      extensionsResult.errors.push(...inlineExtensions.errors);
      const replacementWarnings: Array<{ path: string; warning: string }> = [];
      extensionsResult.extensions = omitReplacedExtensions(
        extensionsResult.extensions,
        replacementWarnings,
      );
      mergeExtensionWarnings(extensionsResult, replacementWarnings);
      return extensionsResult;
    }, this);
  }

  private resolveExtensionLoadPath(path: string): string {
    return isSyntheticPath(path)
      ? path
      : resolvePath(path, this.cwd, { normalizeUnicodeSpaces: true });
  }

  private loadExtensionPaths(
    paths: string[],
    runtime?: ExtensionRuntime,
  ): Effect.Effect<LoadExtensionsResult> {
    return awaitingWith(function* () {
      const isBuiltinPath = (path: string) => path.startsWith(BUILTIN_PATH_PREFIX);
      const result = yield* awaited(
        loadExtensionsCached(
          paths.filter((path) => !isBuiltinPath(path)),
          this.cwd,
          this.eventBus,
          runtime,
        ),
      );
      for (const path of paths.filter(isBuiltinPath)) {
        const builtin = this.builtinExtensions.get(path.slice(BUILTIN_PATH_PREFIX.length));
        if (builtin === undefined) {
          result.errors.push({ error: `Unknown built-in extension: ${path}`, path });
          continue;
        }
        try {
          const extension = yield* awaited(
            loadExtensionFromFactory(
              builtin.factory,
              this.cwd,
              this.eventBus,
              result.runtime,
              path,
            ),
          );
          extension.hidden = true;
          extension.replaceable = builtin.replaceable === true;
          result.extensions.push(extension);
        } catch (error) {
          result.errors.push({
            error: error instanceof Error ? error.message : "failed to load extension",
            path,
          });
        }
      }
      return result;
    }, this);
  }

  private loadFinalExtensionSet(
    extensionPaths: string[],
    preTrustExtensions: LoadExtensionsResult | undefined,
  ): Effect.Effect<LoadExtensionsResult> {
    return awaitingWith(function* () {
      const preloaded = preTrustExtensions?.extensions ?? [];
      const preloadedByPath = new Map(
        preloaded
          .filter((extension) => !extension.path.startsWith("<inline:"))
          .map((extension) => [extension.resolvedPath, extension]),
      );
      const failedPreloadPaths = new Set(
        (preTrustExtensions?.errors ?? []).map((error) =>
          this.resolveExtensionLoadPath(error.path),
        ),
      );
      const remainingPaths = extensionPaths.filter((path) => {
        const resolvedPath = this.resolveExtensionLoadPath(path);
        return !preloadedByPath.has(resolvedPath) && !failedPreloadPaths.has(resolvedPath);
      });
      const remainingExtensions = yield* performed(
        this.loadExtensionPaths(remainingPaths, preTrustExtensions?.runtime),
      );
      const loadedByPath = new Map(preloadedByPath);
      for (const extension of remainingExtensions.extensions) {
        loadedByPath.set(extension.resolvedPath, extension);
      }

      const inlineExtensions =
        preTrustExtensions === undefined
          ? yield* performed(this.loadExtensionFactories(remainingExtensions.runtime))
          : {
              errors: [],
              extensions: preloaded.filter((extension) => extension.path.startsWith("<inline:")),
            };
      const orderedExtensions = extensionPaths
        .map((path) => loadedByPath.get(this.resolveExtensionLoadPath(path)))
        .filter((extension): extension is Extension => extension !== undefined);
      orderedExtensions.push(...inlineExtensions.extensions);

      const replacementWarnings: Array<{ path: string; warning: string }> = [];
      const extensionsResult: LoadExtensionsResult = {
        errors: [
          ...(preTrustExtensions?.errors ?? []),
          ...remainingExtensions.errors,
          ...inlineExtensions.errors,
        ],
        extensions: omitReplacedExtensions(orderedExtensions, replacementWarnings),
        runtime: remainingExtensions.runtime,
        warnings: [
          ...(preTrustExtensions?.warnings ?? []),
          ...(remainingExtensions.warnings ?? []),
        ],
      };
      mergeExtensionWarnings(extensionsResult, replacementWarnings);
      this.addExtensionConflictDiagnostics(extensionsResult);
      return extensionsResult;
    }, this);
  }

  private addExtensionConflictDiagnostics(extensionsResult: LoadExtensionsResult): void {
    const conflicts = this.detectExtensionConflicts(extensionsResult.extensions);
    for (const conflict of conflicts) {
      extensionsResult.errors.push({ error: conflict.message, path: conflict.path });
    }
  }

  private mapSkillPath(
    resource: ResolvedResource,
    metadataByPath: Map<string, PathMetadata>,
  ): string {
    if (resource.metadata.source !== "auto" && resource.metadata.origin !== "package") {
      return resource.path;
    }
    try {
      const stats = statSync(resource.path);
      if (!stats.isDirectory()) {
        return resource.path;
      }
    } catch {
      return resource.path;
    }
    const skillFile = join(resource.path, "SKILL.md");
    if (existsSync(skillFile)) {
      if (!metadataByPath.has(skillFile)) {
        metadataByPath.set(skillFile, resource.metadata);
      }
      return skillFile;
    }
    return resource.path;
  }

  private normalizeExtensionPaths(
    entries: Array<{ path: string; metadata: PathMetadata }>,
  ): Array<{ path: string; metadata: PathMetadata }> {
    return entries.map((entry) => {
      const metadata =
        entry.metadata.baseDir !== undefined && entry.metadata.baseDir !== ""
          ? { ...entry.metadata, baseDir: this.resolveResourcePath(entry.metadata.baseDir) }
          : entry.metadata;
      return {
        metadata,
        path: this.resolveResourcePath(entry.path),
      };
    });
  }

  private updateSkillsFromPaths(
    skillPaths: string[],
    metadataByPath?: Map<string, PathMetadata>,
  ): void {
    let skillsResult: { skills: Skill[]; diagnostics: ResourceDiagnostic[] };
    if (this.noSkills && skillPaths.length === 0) {
      skillsResult = { diagnostics: [], skills: [] };
    } else {
      skillsResult = loadSkills({
        agentDir: this.agentDir,
        cwd: this.cwd,
        includeDefaults: false,
        skillPaths,
      });
    }
    const resolvedSkills =
      this.skillsOverride === undefined ? skillsResult : this.skillsOverride(skillsResult);
    this.skills = resolvedSkills.skills.map((skill) => ({
      ...skill,
      sourceInfo:
        this.findSourceInfoForPath(
          skill.filePath,
          this.extensionSkillSourceInfos,
          metadataByPath,
        ) ??
        skill.sourceInfo ??
        this.getDefaultSourceInfoForPath(skill.filePath),
    }));
    this.skillDiagnostics = resolvedSkills.diagnostics;
  }

  private updatePromptsFromPaths(
    promptPaths: string[],
    metadataByPath?: Map<string, PathMetadata>,
  ): void {
    let promptsResult: { prompts: PromptTemplate[]; diagnostics: ResourceDiagnostic[] };
    if (this.noPromptTemplates && promptPaths.length === 0) {
      promptsResult = { diagnostics: [], prompts: [] };
    } else {
      const loaded = loadPromptTemplates({
        agentDir: this.agentDir,
        cwd: this.cwd,
        includeDefaults: false,
        promptPaths,
      });
      const deduped = this.dedupePrompts(loaded.templates);
      promptsResult = {
        diagnostics: [...loaded.diagnostics, ...deduped.diagnostics],
        prompts: deduped.prompts,
      };
    }
    const resolvedPrompts =
      this.promptsOverride === undefined ? promptsResult : this.promptsOverride(promptsResult);
    this.prompts = resolvedPrompts.prompts.map((prompt) => ({
      ...prompt,
      sourceInfo:
        this.findSourceInfoForPath(
          prompt.filePath,
          this.extensionPromptSourceInfos,
          metadataByPath,
        ) ??
        prompt.sourceInfo ??
        this.getDefaultSourceInfoForPath(prompt.filePath),
    }));
    this.promptDiagnostics = resolvedPrompts.diagnostics;
  }

  private updateThemesFromPaths(
    themePaths: string[],
    metadataByPath?: Map<string, PathMetadata>,
  ): void {
    let themesResult: { themes: Theme[]; diagnostics: ResourceDiagnostic[] };
    if (this.noThemes && themePaths.length === 0) {
      themesResult = { diagnostics: [], themes: [] };
    } else {
      const colorMode = getTerminalColorMode({
        ...detectCapabilities(() => false),
        ...this.settingsManager.getTerminalCapabilityOverrides(),
      });
      const loaded = this.loadThemes(themePaths, false, colorMode);
      const deduped = this.dedupeThemes(loaded.themes);
      themesResult = {
        diagnostics: [...loaded.diagnostics, ...deduped.diagnostics],
        themes: deduped.themes,
      };
    }
    const resolvedThemes =
      this.themesOverride === undefined ? themesResult : this.themesOverride(themesResult);
    this.themes = resolvedThemes.themes.map((theme) => {
      const sourcePath = theme.sourcePath;
      theme.sourceInfo =
        sourcePath !== undefined && sourcePath !== ""
          ? (this.findSourceInfoForPath(
              sourcePath,
              this.extensionThemeSourceInfos,
              metadataByPath,
            ) ??
            theme.sourceInfo ??
            this.getDefaultSourceInfoForPath(sourcePath))
          : theme.sourceInfo;
      return theme;
    });
    this.themeDiagnostics = resolvedThemes.diagnostics;
  }

  private applyExtensionSourceInfo(
    extensions: Extension[],
    metadataByPath: Map<string, PathMetadata>,
  ): void {
    for (const extension of extensions) {
      extension.sourceInfo =
        this.findSourceInfoForPath(extension.path, undefined, metadataByPath) ??
        this.getDefaultSourceInfoForPath(extension.path);
      for (const command of extension.commands.values()) {
        command.sourceInfo = extension.sourceInfo;
      }
      for (const tool of extension.tools.values()) {
        tool.sourceInfo = extension.sourceInfo;
      }
    }
  }

  private findSourceInfoForPath(
    resourcePath: string,
    extraSourceInfos?: Map<string, SourceInfo>,
    metadataByPath?: Map<string, PathMetadata>,
  ): SourceInfo | undefined {
    if (resourcePath === "") {
      return undefined;
    }

    if (isSyntheticPath(resourcePath)) {
      return this.getDefaultSourceInfoForPath(resourcePath);
    }

    const normalizedResourcePath = resolve(resourcePath);
    if (extraSourceInfos !== undefined) {
      for (const [sourcePath, sourceInfo] of extraSourceInfos.entries()) {
        const normalizedSourcePath = resolve(sourcePath);
        if (
          normalizedResourcePath === normalizedSourcePath ||
          normalizedResourcePath.startsWith(`${normalizedSourcePath}${sep}`)
        ) {
          return { ...sourceInfo, path: resourcePath };
        }
      }
    }

    if (metadataByPath !== undefined) {
      const exact = metadataByPath.get(normalizedResourcePath) ?? metadataByPath.get(resourcePath);
      if (exact !== undefined) {
        return createSourceInfo(resourcePath, exact);
      }

      for (const [sourcePath, metadata] of metadataByPath.entries()) {
        const normalizedSourcePath = resolve(sourcePath);
        if (
          normalizedResourcePath === normalizedSourcePath ||
          normalizedResourcePath.startsWith(`${normalizedSourcePath}${sep}`)
        ) {
          return createSourceInfo(resourcePath, metadata);
        }
      }
    }

    return undefined;
  }

  private getDefaultSourceInfoForPath(filePath: string): SourceInfo {
    const syntheticSource = getSyntheticPathSource(filePath);
    if (syntheticSource !== undefined && syntheticSource !== "") {
      return {
        origin: "top-level",
        path: filePath,
        scope: "temporary",
        source: syntheticSource,
      };
    }

    const normalizedPath = resolve(filePath);
    const agentRoots = [
      join(this.agentDir, "skills"),
      join(this.agentDir, "prompts"),
      join(this.agentDir, "themes"),
      join(this.agentDir, "extensions"),
    ];
    const projectRoots = [
      join(this.cwd, CONFIG_DIR_NAME, "skills"),
      join(this.cwd, CONFIG_DIR_NAME, "prompts"),
      join(this.cwd, CONFIG_DIR_NAME, "themes"),
      join(this.cwd, CONFIG_DIR_NAME, "extensions"),
    ];

    for (const root of agentRoots) {
      if (this.isUnderPath(normalizedPath, root)) {
        return {
          baseDir: root,
          origin: "top-level",
          path: filePath,
          scope: "user",
          source: "local",
        };
      }
    }

    for (const root of projectRoots) {
      if (this.isUnderPath(normalizedPath, root)) {
        return {
          baseDir: root,
          origin: "top-level",
          path: filePath,
          scope: "project",
          source: "local",
        };
      }
    }

    return {
      baseDir: statSync(normalizedPath).isDirectory()
        ? normalizedPath
        : resolve(normalizedPath, ".."),
      origin: "top-level",
      path: filePath,
      scope: "temporary",
      source: "local",
    };
  }

  private mergePaths(primary: string[], additional: string[]): string[] {
    const merged: string[] = [];
    const seen = new Set<string>();

    for (const p of [...primary, ...additional]) {
      const resolved = this.resolveResourcePath(p);
      const canonicalPath = canonicalizePath(resolved);
      if (seen.has(canonicalPath)) continue;
      seen.add(canonicalPath);
      merged.push(resolved);
    }

    return merged;
  }

  private resolveResourcePath(p: string): string {
    return isSyntheticPath(p) ? p : resolvePath(p, this.cwd, { trim: true });
  }

  private loadThemes(
    paths: string[],
    includeDefaults: boolean,
    colorMode: tuiTypes.TerminalColorMode,
  ): {
    themes: Theme[];
    diagnostics: ResourceDiagnostic[];
  } {
    const themes: Theme[] = [];
    const diagnostics: ResourceDiagnostic[] = [];
    if (includeDefaults) {
      const defaultDirs = [
        join(this.agentDir, "themes"),
        join(this.cwd, CONFIG_DIR_NAME, "themes"),
      ];

      for (const dir of defaultDirs) {
        this.loadThemesFromDir(dir, themes, diagnostics, colorMode);
      }
    }

    for (const p of paths) {
      const resolved = this.resolveResourcePath(p);
      if (!existsSync(resolved)) {
        diagnostics.push({ message: "theme path does not exist", path: resolved, type: "warning" });
        continue;
      }

      try {
        const stats = statSync(resolved);
        if (stats.isDirectory()) {
          this.loadThemesFromDir(resolved, themes, diagnostics, colorMode);
        } else if (stats.isFile() && resolved.endsWith(".json")) {
          this.loadThemeFromFile(resolved, themes, diagnostics, colorMode);
        } else {
          diagnostics.push({
            message: "theme path is not a json file",
            path: resolved,
            type: "warning",
          });
        }
      } catch (error) {
        const message = error instanceof Error ? error.message : "failed to read theme path";
        diagnostics.push({ message, path: resolved, type: "warning" });
      }
    }

    return { diagnostics, themes };
  }

  private loadThemesFromDir(
    dir: string,
    themes: Theme[],
    diagnostics: ResourceDiagnostic[],
    colorMode: tuiTypes.TerminalColorMode,
  ): void {
    if (!existsSync(dir)) {
      return;
    }

    try {
      const entries = readdirSync(dir, { withFileTypes: true });
      for (const entry of entries) {
        let isFile = entry.isFile();
        if (entry.isSymbolicLink()) {
          try {
            isFile = statSync(join(dir, entry.name)).isFile();
          } catch {
            continue;
          }
        }
        if (!isFile) {
          continue;
        }
        if (!entry.name.endsWith(".json")) {
          continue;
        }
        this.loadThemeFromFile(join(dir, entry.name), themes, diagnostics, colorMode);
      }
    } catch (error) {
      const message = error instanceof Error ? error.message : "failed to read theme directory";
      diagnostics.push({ message, path: dir, type: "warning" });
    }
  }

  private loadThemeFromFile(
    filePath: string,
    themes: Theme[],
    diagnostics: ResourceDiagnostic[],
    colorMode: tuiTypes.TerminalColorMode,
  ): void {
    try {
      themes.push(loadThemeFromPath(filePath, colorMode));
    } catch (error) {
      const message = error instanceof Error ? error.message : "failed to load theme";
      diagnostics.push({ message, path: filePath, type: "warning" });
    }
  }

  private loadExtensionFactories(runtime: ExtensionRuntime): Effect.Effect<{
    extensions: Extension[];
    errors: Array<{ path: string; error: string }>;
  }> {
    return awaitingWith(function* () {
      const extensions: Extension[] = [];
      const errors: Array<{ path: string; error: string }> = [];

      for (const [index, input] of this.extensionFactories.entries()) {
        const isNamed = typeof input !== "function";
        const factory = isNamed ? input.factory : input;
        const extensionPath = `<inline:${isNamed ? input.name : index + 1}>`;
        try {
          const extension = yield* awaited(
            loadExtensionFromFactory(factory, this.cwd, this.eventBus, runtime, extensionPath),
          );
          extension.hidden = isNamed && input.hidden === true;
          extension.replaceable = isNamed && input.replaceable === true;
          extensions.push(extension);
        } catch (error) {
          const message = error instanceof Error ? error.message : "failed to load extension";
          errors.push({ error: message, path: extensionPath });
        }
      }

      return { errors, extensions };
    }, this);
  }

  private dedupePrompts(prompts: PromptTemplate[]): {
    prompts: PromptTemplate[];
    diagnostics: ResourceDiagnostic[];
  } {
    const seen = new Map<string, PromptTemplate>();
    const diagnostics: ResourceDiagnostic[] = [];

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

  private dedupeThemes(themes: Theme[]): { themes: Theme[]; diagnostics: ResourceDiagnostic[] } {
    const seen = new Map<string, Theme>();
    const diagnostics: ResourceDiagnostic[] = [];

    for (const t of themes) {
      const name = t.name ?? "unnamed";
      const existing = seen.get(name);
      if (existing === undefined) {
        seen.set(name, t);
      } else {
        diagnostics.push({
          collision: {
            loserPath: t.sourcePath ?? "<builtin>",
            name,
            resourceType: "theme",
            winnerPath: existing.sourcePath ?? "<builtin>",
          },
          message: `name "${name}" collision`,
          path: t.sourcePath,
          type: "collision",
        });
      }
    }

    return { diagnostics, themes: Array.from(seen.values()) };
  }

  private discoverSystemPromptFile(): string | undefined {
    const projectPath = join(this.cwd, CONFIG_DIR_NAME, "SYSTEM.md");
    if (this.settingsManager.isProjectTrusted() && existsSync(projectPath)) {
      return projectPath;
    }

    const globalPath = join(this.agentDir, "SYSTEM.md");
    if (existsSync(globalPath)) {
      return globalPath;
    }

    return undefined;
  }

  private discoverAppendSystemPromptFile(): string | undefined {
    const projectPath = join(this.cwd, CONFIG_DIR_NAME, "APPEND_SYSTEM.md");
    if (this.settingsManager.isProjectTrusted() && existsSync(projectPath)) {
      return projectPath;
    }

    const globalPath = join(this.agentDir, "APPEND_SYSTEM.md");
    if (existsSync(globalPath)) {
      return globalPath;
    }

    return undefined;
  }

  private isUnderPath(target: string, root: string): boolean {
    const normalizedRoot = resolve(root);
    if (target === normalizedRoot) {
      return true;
    }
    const prefix = normalizedRoot.endsWith(sep) ? normalizedRoot : `${normalizedRoot}${sep}`;
    return target.startsWith(prefix);
  }

  private detectExtensionConflicts(
    extensions: Extension[],
  ): Array<{ path: string; message: string }> {
    const conflicts: Array<{ path: string; message: string }> = [];

    const toolOwners = new Map<string, string>();
    const flagOwners = new Map<string, string>();

    for (const ext of extensions) {
      for (const toolName of ext.tools.keys()) {
        const existingOwner = toolOwners.get(toolName);
        if (existingOwner !== undefined && existingOwner !== "" && existingOwner !== ext.path) {
          conflicts.push({
            message: `Tool "${toolName}" conflicts with ${existingOwner}`,
            path: ext.path,
          });
        } else {
          toolOwners.set(toolName, ext.path);
        }
      }

      for (const flagName of ext.flags.keys()) {
        const existingOwner = flagOwners.get(flagName);
        if (existingOwner !== undefined && existingOwner !== "" && existingOwner !== ext.path) {
          conflicts.push({
            message: `Flag "--${flagName}" conflicts with ${existingOwner}`,
            path: ext.path,
          });
        } else {
          flagOwners.set(flagName, ext.path);
        }
      }
    }

    return conflicts;
  }
}
