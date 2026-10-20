import tuiComponent from "../../../libs/tui/src/tui-component.ts";
import type { QuietStartup } from "../src/core/settings-manager.ts";
import type { SourceInfo } from "../src/core/source-info.ts";
import { InteractiveMode } from "../src/modes/interactive/interactive-mode.ts";
import type interactiveModeStatus5SupportTypes from "./interactive-mode-status-5-support.types.ts";

const { Container } = tuiComponent;

type ShowLoadedResourcesOptions = {
  quietStartup: QuietStartup;
  verbose?: boolean;
  toolOutputExpanded?: boolean;
  cwd?: string;
  contextFiles?: Array<{ path: string; content?: string }>;
  systemPromptSource?: { path: string };
  appendSystemPromptSources?: Array<{ path: string }>;
  extensions?: interactiveModeStatus5SupportTypes.ExtensionFixture[];
  skills?: Array<{ filePath: string; name: string }>;
  skillDiagnostics?: Array<{ type: "warning" | "error" | "collision"; message: string }>;
};

function createShowLoadedResourcesThis(options: ShowLoadedResourcesOptions) {
  const fakeThis: any = {
    chatContainer: new Container(),
    getBuiltInCommandConflictDiagnostics: () => [],
    getStartupVisibility: () =>
      (InteractiveMode as any).prototype.getStartupVisibility.call(fakeThis),
    isStartupExpanded: () => (InteractiveMode as any).prototype.isStartupExpanded.call(fakeThis),
    loadedResourcesContainer: new Container(),
    options: { verbose: options.verbose ?? false },
    session: {
      extensionRunner: {
        getCommandDiagnostics: () => [],
        getShortcutDiagnostics: () => [],
      },
      promptTemplates: [],
      resourceLoader: {
        getAgentsFiles: () => ({ agentsFiles: options.contextFiles ?? [] }),
        getAppendSystemPromptSources: () => options.appendSystemPromptSources ?? [],
        getExtensions: () => ({ errors: [], extensions: options.extensions ?? [], runtime: {} }),
        getPathMetadata: () => new Map(),
        getPrompts: () => ({ diagnostics: [], prompts: [] }),
        getSkills: () => ({
          diagnostics: options.skillDiagnostics ?? [],
          skills: options.skills ?? [],
        }),
        getSystemPromptSource: () => options.systemPromptSource,
        getThemes: () => ({ diagnostics: [], themes: [] }),
      },
    },
    sessionManager: {
      getCwd: () => options.cwd ?? "/tmp/project",
    },
    settingsManager: {
      getQuietStartup: () => options.quietStartup,
    },
    toolOutputExpanded: options.toolOutputExpanded ?? false,
  };

  return fakeThis;
}

function createSourceInfo(
  filePath: string,
  options: {
    source: string;
    scope: "user" | "project" | "temporary";
    origin: "package" | "top-level";
    baseDir?: string;
  },
): SourceInfo {
  return {
    origin: options.origin,
    path: filePath,
    scope: options.scope,
    source: options.source,
    ...(options.baseDir === undefined ? {} : { baseDir: options.baseDir }),
  };
}

const fixture = (
  path: string,
  baseDir: string,
  source: string,
  scope: "user" | "project" | "temporary" = "project",
): interactiveModeStatus5SupportTypes.ExtensionFixture => ({
  path,
  sourceInfo: createSourceInfo(path, {
    baseDir,
    origin: source.startsWith("npm:") || source.startsWith("git:") ? "package" : "top-level",
    scope,
    source,
  }),
});

const subagentsRepo = "/tmp/project/.msa/git/github.com/HazAT/pi-interactive-subagents";

function createExtensionFixtures(): interactiveModeStatus5SupportTypes.ExtensionFixture[] {
  return [
    fixture("/tmp/project/.msa/extensions/answer.ts", "/tmp/project/.msa/extensions", "local"),
    fixture(
      "/tmp/project/.msa/extensions/local-index/index.ts",
      "/tmp/project/.msa/extensions",
      "local",
    ),
    fixture("/tmp/agent/extensions/user-index/index.ts", "/tmp/agent/extensions", "local", "user"),
    fixture(
      "/tmp/project/.msa/npm/node_modules/msa-markdown-preview/extensions/index.ts",
      "/tmp/project/.msa/npm/node_modules/msa-markdown-preview",
      "npm:msa-markdown-preview",
    ),
    fixture(
      "/tmp/project/.msa/npm/node_modules/@scope/msa-scoped/extensions/index.ts",
      "/tmp/project/.msa/npm/node_modules/@scope/msa-scoped",
      "npm:@scope/msa-scoped",
    ),
    fixture(
      `${subagentsRepo}/extensions/index.ts`,
      subagentsRepo,
      "git:github.com/HazAT/pi-interactive-subagents",
    ),
    fixture(
      `${subagentsRepo}/extensions/subagents/index.ts`,
      subagentsRepo,
      "git:github.com/HazAT/pi-interactive-subagents",
    ),
    fixture("/tmp/temp/cli-extension.ts", "/tmp/temp", "cli", "temporary"),
  ];
}

const interactiveModeStatus5Support = {
  createExtensionFixtures,
  createShowLoadedResourcesThis,
  createSourceInfo,
};

export default interactiveModeStatus5Support;
