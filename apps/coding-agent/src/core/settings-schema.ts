import modelSchema from "@msa/ai/providers/model-schema";
import { type Static, type TSchemaOptions, Type } from "typebox";

import { SETTINGS_DEFAULTS } from "./settings-defaults.ts";

const { ModelThinkingLevelSchema } = modelSchema;

function nonNegativeSafeInteger(options: TSchemaOptions & { default?: number } = {}) {
  return Type.Integer({ maximum: Number.MAX_SAFE_INTEGER, minimum: 0, ...options });
}

function timeoutSetting(options?: TSchemaOptions) {
  return Type.Union([Type.Number({ minimum: 0 }), Type.Literal("disabled")], options);
}

const CompactionModelOverrideSchema = Type.Object({
  keepRecentTokens: Type.Optional(nonNegativeSafeInteger()),
  reserveTokens: Type.Optional(nonNegativeSafeInteger()),
});

const CompactionSettingsSchema = Type.Object({
  enabled: Type.Optional(Type.Boolean({ default: SETTINGS_DEFAULTS.compaction.enabled })),
  keepRecentTokens: Type.Optional(
    nonNegativeSafeInteger({ default: SETTINGS_DEFAULTS.compaction.keepRecentTokens }),
  ),
  modelOverrides: Type.Optional(
    Type.Record(Type.String(), CompactionModelOverrideSchema, {
      description: 'Per-model overrides keyed by exact "provider/modelId" strings.',
    }),
  ),
  reserveTokens: Type.Optional(
    nonNegativeSafeInteger({ default: SETTINGS_DEFAULTS.compaction.reserveTokens }),
  ),
});

const BranchSummarySettingsSchema = Type.Object({
  reserveTokens: Type.Optional(
    Type.Number({
      default: SETTINGS_DEFAULTS.branchSummary.reserveTokens,
      description: "Tokens reserved for the prompt and LLM response.",
    }),
  ),
  skipPrompt: Type.Optional(
    Type.Boolean({
      default: SETTINGS_DEFAULTS.branchSummary.skipPrompt,
      description: 'When true, skips the "Summarize branch?" prompt and defaults to no summary.',
    }),
  ),
});

const ProviderRetrySettingsSchema = Type.Object({
  maxRetries: Type.Optional(Type.Number({ description: "SDK or provider retry attempts." })),
  maxRetryDelayMs: Type.Optional(
    Type.Number({
      description: "Maximum server-requested delay before failing.",
      default: SETTINGS_DEFAULTS.retry.provider.maxRetryDelayMs,
    }),
  ),
  timeoutMs: Type.Optional(
    Type.Number({ description: "SDK or provider request timeout in milliseconds." }),
  ),
});

const RetrySettingsSchema = Type.Object({
  baseDelayMs: Type.Optional(
    Type.Number({
      description: "Exponential backoff base delay in milliseconds: 2s, 4s, 8s.",
      default: SETTINGS_DEFAULTS.retry.baseDelayMs,
    }),
  ),
  enabled: Type.Optional(Type.Boolean({ default: SETTINGS_DEFAULTS.retry.enabled })),
  maxAgentDelayMs: Type.Optional(Type.Number({ default: SETTINGS_DEFAULTS.retry.maxAgentDelayMs })),
  maxDelayMs: Type.Optional(
    Type.Number({
      description: "Legacy retry delay setting. Use provider.maxRetryDelayMs instead.",
      deprecated: true,
    }),
  ),
  maxRetries: Type.Optional(Type.Number({ default: SETTINGS_DEFAULTS.retry.maxRetries })),
  provider: Type.Optional(ProviderRetrySettingsSchema),
});

const TerminalSettingsSchema = Type.Object({
  clearOnShrink: Type.Optional(
    Type.Boolean({
      description: "Clear empty rows when content shrinks.",
      default: SETTINGS_DEFAULTS.terminal.clearOnShrink,
    }),
  ),
  hyperlinks: Type.Optional(Type.Union([Type.Boolean(), Type.Literal("auto")])),
  imageWidthCells: Type.Optional(
    Type.Number({
      description: "Preferred inline image width in terminal cells.",
      default: SETTINGS_DEFAULTS.terminal.imageWidthCells,
    }),
  ),
  images: Type.Optional(
    Type.Union([
      Type.Literal("kitty"),
      Type.Literal("iterm2"),
      Type.Literal("auto"),
      Type.Literal(false),
    ]),
  ),
  showImages: Type.Optional(
    Type.Boolean({
      description: "Show images when the terminal supports them.",
      default: SETTINGS_DEFAULTS.terminal.showImages,
    }),
  ),
  showTerminalProgress: Type.Optional(
    Type.Boolean({
      description: "Show OSC 9;4 terminal progress indicators.",
      default: SETTINGS_DEFAULTS.terminal.showTerminalProgress,
    }),
  ),
  trueColor: Type.Optional(Type.Union([Type.Boolean(), Type.Literal("auto")])),
});

const ImageSettingsSchema = Type.Object({
  autoResize: Type.Optional(
    Type.Boolean({
      default: SETTINGS_DEFAULTS.images.autoResize,
      description: "Resize images to 2000x2000 maximum for better model compatibility.",
    }),
  ),
  blockImages: Type.Optional(
    Type.Boolean({
      default: SETTINGS_DEFAULTS.images.blockImages,
      description: "When true, prevents all images from being sent to LLM providers.",
    }),
  ),
});

const MemoryEmbeddingSettingsSchema = Type.Object({
  apiKeyEnv: Type.Optional(
    Type.String({
      description: "Environment variable holding the API key, for endpoints that need one.",
    }),
  ),
  baseUrl: Type.Optional(
    Type.String({
      description:
        "OpenAI-compatible base URL such as http://127.0.0.1:11434/v1 (Ollama) or https://api.openai.com/v1. /embeddings is appended.",
      default: SETTINGS_DEFAULTS.memory.embedding.baseUrl,
    }),
  ),
  documentPrefix: Type.Optional(
    Type.String({
      description: "Prepended to memory text before embedding.",
      default: SETTINGS_DEFAULTS.memory.embedding.documentPrefix,
    }),
  ),
  enabled: Type.Optional(
    Type.Boolean({
      description: "Compute embeddings so memories are searchable by meaning, not only keywords.",
      default: SETTINGS_DEFAULTS.memory.embedding.enabled,
    }),
  ),
  model: Type.Optional(
    Type.String({
      description: "Embedding model name at that endpoint.",
      default: SETTINGS_DEFAULTS.memory.embedding.model,
    }),
  ),
  queryPrefix: Type.Optional(
    Type.String({
      description:
        "Prepended to search queries, for models trained with task prefixes (EmbeddingGemma). Clear it for models that use none.",
      default: SETTINGS_DEFAULTS.memory.embedding.queryPrefix,
    }),
  ),
  timeoutMs: Type.Optional(
    nonNegativeSafeInteger({
      description: "Embedding request timeout in milliseconds.",
      default: SETTINGS_DEFAULTS.memory.embedding.timeoutMs,
    }),
  ),
});

const MemoryRecallSettingsSchema = Type.Object({
  enabled: Type.Optional(
    Type.Boolean({
      default: SETTINGS_DEFAULTS.memory.recall.enabled,
      description: "Recall memories relevant to each user prompt and add them to the run.",
    }),
  ),
  limit: Type.Optional(
    nonNegativeSafeInteger({
      default: SETTINGS_DEFAULTS.memory.recall.limit,
      description: "Maximum memories added to a run.",
    }),
  ),
  minScore: Type.Optional(
    Type.Number({
      default: SETTINGS_DEFAULTS.memory.recall.minScore,
      description:
        "Minimum relevance (0-1) for a memory to be recalled: its embedding similarity, or the share of query words it holds. Embedding models differ in their score range, so tune this with the model.",
    }),
  ),
});

const MemorySettingsSchema = Type.Object({
  database: Type.Optional(
    Type.String({ description: "SQLite file holding memories. Default: <agent dir>/memory.db." }),
  ),
  embedding: Type.Optional(MemoryEmbeddingSettingsSchema),
  enabled: Type.Optional(
    Type.Boolean({
      description: "Long-term memory: the memory tool, recall, and the /memory command.",
      default: SETTINGS_DEFAULTS.memory.enabled,
    }),
  ),
  recall: Type.Optional(MemoryRecallSettingsSchema),
});

function thinkingBudgetsSettings(options?: TSchemaOptions) {
  return Type.Object(
    {
      high: Type.Optional(Type.Number()),
      low: Type.Optional(Type.Number()),
      medium: Type.Optional(Type.Number()),
      minimal: Type.Optional(Type.Number()),
    },
    options,
  );
}

const ThinkingBudgetsSettingsSchema = thinkingBudgetsSettings();

const MarkdownSettingsSchema = Type.Object({
  codeBlockIndent: Type.Optional(
    Type.String({ default: SETTINGS_DEFAULTS.markdown.codeBlockIndent }),
  ),
  mermaid: Type.Optional(
    Type.Union([Type.Literal("off"), Type.Literal("final"), Type.Literal("streaming")], {
      default: SETTINGS_DEFAULTS.markdown.mermaid,
    }),
  ),
});

function codemodeMode(options?: TSchemaOptions) {
  return Type.Union([Type.Literal("on"), Type.Literal("only")], options);
}

const CodemodeModeSchema = codemodeMode();

const CodemodeSettingsSchema = Type.Object({
  inlineBudget: Type.Optional(
    Type.Number({
      minimum: 0,
      description: "Estimated tokens available for inline codemode tool declarations.",
      default: SETTINGS_DEFAULTS.codemode.inlineBudget,
    }),
  ),
  mode: Type.Optional(
    codemodeMode({
      description:
        'How codemode presents tools. "on" keeps direct tools declared and annotates tools callable from scripts; codemode lists only tools without direct exposure. "only" lists every script-callable tool in codemode and does not declare active direct tools.',
      default: SETTINGS_DEFAULTS.codemode.mode,
    }),
  ),
});

const PrWatchSettingsSchema = Type.Object({
  intervalSeconds: Type.Optional(
    Type.Number({
      default: SETTINGS_DEFAULTS.prWatch.intervalSeconds,
      description: "Seconds between checks of a watched pull request.",
      minimum: 5,
    }),
  ),
  statusIntervalSeconds: Type.Optional(
    Type.Number({
      default: SETTINGS_DEFAULTS.prWatch.statusIntervalSeconds,
      description: "Seconds without a change before a watch reports its status again.",
      minimum: 30,
    }),
  ),
});

const PackageSourceSchema = Type.Union(
  [
    Type.String({ description: "Load all resources from the package." }),
    Type.Object({
      autoload: Type.Optional(
        Type.Boolean({
          description: "When false, start empty and only apply explicit resource patterns.",
        }),
      ),
      extensions: Type.Optional(Type.Array(Type.String())),
      prompts: Type.Optional(Type.Array(Type.String())),
      skills: Type.Optional(Type.Array(Type.String())),
      source: Type.String(),
      themes: Type.Optional(Type.Array(Type.String())),
    }),
  ],
  {
    description:
      "Package source for npm or git packages. Use the string form to load all resources or the object form to filter resources.",
  },
);

const ModelPolicySettingsSchema = Type.Object(
  {
    allow: Type.Optional(
      Type.Array(Type.String(), {
        description:
          "Models that may be used, in the same format as the --models CLI flag. When set, models outside the list are unusable.",
      }),
    ),
    deny: Type.Optional(
      Type.Array(Type.String(), {
        description:
          "Models that may not be used, in the same format as the --models CLI flag. A deny pattern wins over any allow pattern.",
      }),
    ),
  },
  {
    description:
      "Models a session may use. Deny wins, and a non-empty allow list restricts use to the models it names. Separate from enabledModels, which only narrows startup selection and Ctrl+P cycling.",
  },
);

const StringArraySchema = Type.Array(Type.String());
const SkillsInputSchema = Type.Union(
  [
    StringArraySchema,
    Type.Object(
      {
        customDirectories: Type.Optional(StringArraySchema),
        enableSkillCommands: Type.Optional(Type.Boolean()),
      },
      { deprecated: true },
    ),
  ],
  { description: "Local skill file paths or directories." },
);

export const SettingsSchema = Type.Object(
  {
    $schema: Type.Optional(Type.String({ description: "JSON Schema reference." })),
    autocompleteMaxVisible: Type.Optional(
      Type.Number({
        description: "Maximum visible items in the autocomplete dropdown.",
        default: SETTINGS_DEFAULTS.autocompleteMaxVisible,
      }),
    ),
    branchSummary: Type.Optional(BranchSummarySettingsSchema),
    cacheWarming: Type.Optional(
      Type.Union([Type.Literal("off"), Type.Literal("streaming"), Type.Literal("idle")], {
        description:
          'Cache-warming profile. "idle" also warms between agent runs. Global only because each refresh costs money.',
        default: SETTINGS_DEFAULTS.cacheWarming,
      }),
    ),
    clipboardImageCommand: Type.Optional(
      Type.String({
        description:
          "Shell command whose stdout is the clipboard image, read by the paste key in place of the local clipboard. Global setting only.",
      }),
    ),
    codemode: Type.Optional(CodemodeSettingsSchema),
    collapseChangelog: Type.Optional(
      Type.Boolean({
        description:
          "Show the condensed changelog after update; use /release-notes for the full changelog.",
        default: SETTINGS_DEFAULTS.collapseChangelog,
      }),
    ),
    compaction: Type.Optional(CompactionSettingsSchema),
    defaultModel: Type.Optional(Type.String()),
    defaultProjectTrust: Type.Optional(
      Type.Union([Type.Literal("ask"), Type.Literal("always"), Type.Literal("never")], {
        description: "Global setting only.",
        default: SETTINGS_DEFAULTS.defaultProjectTrust,
      }),
    ),
    defaultProvider: Type.Optional(Type.String()),
    defaultThinkingLevel: Type.Optional(ModelThinkingLevelSchema),
    defaultTools: Type.Optional(
      Type.Array(Type.String(), {
        description:
          "Initial tool selection. Plain names replace the inherited selection; +name and -name entries add or remove tools.",
      }),
    ),
    deviceId: Type.Optional(
      Type.String({
        description:
          "Stable installation UUID, generated when authentication first needs it. Global only.",
      }),
    ),
    doubleEscapeAction: Type.Optional(
      Type.Union([Type.Literal("fork"), Type.Literal("tree"), Type.Literal("none")], {
        description: "Action for double-escape with an empty editor.",
        default: SETTINGS_DEFAULTS.doubleEscapeAction,
      }),
    ),
    editorPaddingX: Type.Optional(
      Type.Number({
        description: "Horizontal padding for the input editor.",
        default: SETTINGS_DEFAULTS.editorPaddingX,
      }),
    ),
    enableAnalytics: Type.Optional(
      Type.Boolean({
        description: "Opt in to analytics data sharing.",
        default: SETTINGS_DEFAULTS.enableAnalytics,
      }),
    ),
    enableInstallTelemetry: Type.Optional(
      Type.Boolean({
        description: "Send attribution headers to OpenRouter.",
        default: SETTINGS_DEFAULTS.enableInstallTelemetry,
      }),
    ),
    enableSkillCommands: Type.Optional(
      Type.Boolean({
        description: "Register skills as /name commands.",
        default: SETTINGS_DEFAULTS.enableSkillCommands,
      }),
    ),
    enabledModels: Type.Optional(
      Type.Array(Type.String(), {
        description: "Model patterns for cycling, in the same format as the --models CLI flag.",
      }),
    ),
    extensions: Type.Optional(
      Type.Array(Type.String(), { description: "Local extension file paths or directories." }),
    ),
    externalEditor: Type.Optional(
      Type.String({
        description: "Command for Ctrl+G external editor; takes precedence over VISUAL and EDITOR.",
      }),
    ),
    followUpMode: Type.Optional(
      Type.Union([Type.Literal("all"), Type.Literal("one-at-a-time")], {
        default: SETTINGS_DEFAULTS.followUpMode,
      }),
    ),
    fullscreenCopyOnSelect: Type.Optional(
      Type.Boolean({
        description: "No effect in regular TUI mode.",
        default: SETTINGS_DEFAULTS.fullscreenCopyOnSelect,
      }),
    ),
    fullscreenExitOutput: Type.Optional(
      Type.Union([Type.Literal("transcript"), Type.Literal("resume-hint")], {
        description: "No effect in regular TUI mode.",
        default: SETTINGS_DEFAULTS.fullscreenExitOutput,
      }),
    ),
    fullscreenScrollbar: Type.Optional(
      Type.Union([Type.Literal("auto"), Type.Literal("always"), Type.Literal("hidden")], {
        description: "No effect in regular TUI mode.",
        default: SETTINGS_DEFAULTS.fullscreenScrollbar,
      }),
    ),
    fullscreenWheelScrollLines: Type.Optional(
      Type.Union([Type.Number(), Type.Literal("auto")], {
        description:
          "Lines scrolled per wheel event in fullscreen mode; numeric values are clamped from 1 to 100.",
        default: SETTINGS_DEFAULTS.fullscreenWheelScrollLines,
      }),
    ),
    goal: Type.Optional(
      Type.Object({
        evaluatorModel: Type.Optional(
          Type.String({
            description:
              'Model that judges /goal conditions, as "provider/id". Default: the strongest small model (haiku, flash, mini, lite, small) of the working model\'s provider, or the working model.',
          }),
        ),
      }),
    ),
    hideThinkingBlock: Type.Optional(
      Type.Boolean({ default: SETTINGS_DEFAULTS.hideThinkingBlock }),
    ),
    httpIdleTimeoutMs: Type.Optional(
      timeoutSetting({
        description:
          'HTTP header or body idle timeout in milliseconds; 0 or "disabled" disables it.',
      }),
    ),
    httpProxy: Type.Optional(
      Type.String({
        description:
          "Proxy URL applied as HTTP_PROXY and HTTPS_PROXY for msa-managed HTTP clients.",
      }),
    ),
    images: Type.Optional(ImageSettingsSchema),
    lastChangelogVersion: Type.Optional(Type.String()),
    markdown: Type.Optional(MarkdownSettingsSchema),
    memory: Type.Optional(MemorySettingsSchema),
    modelPolicy: Type.Optional(ModelPolicySettingsSchema),
    modelThinkingLevels: Type.Optional(
      Type.Record(Type.String(), ModelThinkingLevelSchema, {
        description: 'Per-model default thinking level overrides keyed by "provider/modelId".',
      }),
    ),
    npmCommand: Type.Optional(
      Type.Array(Type.String(), {
        description:
          'Command used for npm package lookup and installation, in argv form such as ["mise", "exec", "node@20", "--", "npm"].',
      }),
    ),
    orchestrator: Type.Optional(
      Type.Object({
        database: Type.Optional(
          Type.String({
            description:
              "SQLite file holding tasks, threads, reports, and notes. Default: <agent dir>/orchestrator.db.",
          }),
        ),
        workerModel: Type.Optional(
          Type.String({
            description:
              'Model of the threads the orchestrator starts, as "provider/id", unless create_task names one. Default: the orchestrator\'s model.',
          }),
        ),
        workerThinkingLevel: Type.Optional(ModelThinkingLevelSchema),
        reviewModel: Type.Optional(
          Type.String({
            description:
              'Model of the review thread that closes each round, as "provider/id". Default: the orchestrator\'s model.',
          }),
        ),
        reviewThinkingLevel: Type.Optional(ModelThinkingLevelSchema),
        maxConcurrentThreads: Type.Optional(
          Type.Integer({
            minimum: 1,
            default: SETTINGS_DEFAULTS.orchestrator.maxConcurrentThreads,
          }),
        ),
      }),
    ),
    outputPad: Type.Optional(
      Type.Union([Type.Literal(0), Type.Literal(1)], {
        description: "Horizontal padding for transcript content.",
        default: SETTINGS_DEFAULTS.outputPad,
      }),
    ),
    packages: Type.Optional(
      Type.Array(PackageSourceSchema, {
        description: "npm or git package sources, as strings or objects with resource filtering.",
      }),
    ),
    prWatch: Type.Optional(PrWatchSettingsSchema),
    prompts: Type.Optional(
      Type.Array(Type.String(), {
        description: "Local prompt template file paths or directories.",
      }),
    ),
    queueMode: Type.Optional(
      Type.Union([Type.Literal("all"), Type.Literal("one-at-a-time")], {
        description: "Legacy setting migrated to steeringMode.",
        deprecated: true,
      }),
    ),
    quietStartup: Type.Optional(
      Type.Union([Type.Boolean(), Type.Literal("header")], {
        description:
          'When true, hide all startup output. When "header", keep only the startup header.',
        default: SETTINGS_DEFAULTS.quietStartup,
      }),
    ),
    retry: Type.Optional(RetrySettingsSchema),
    sessionDir: Type.Optional(
      Type.String({
        description:
          "Custom session storage directory, in the same format as the --session-dir CLI flag.",
      }),
    ),
    shellCommandPrefix: Type.Optional(
      Type.String({
        description: "Prefix prepended to every bash command, for example to enable shell aliases.",
      }),
    ),
    shellPath: Type.Optional(
      Type.String({
        description:
          "Custom shell path, for example for Cygwin on Windows, with support for leading ~ expansion.",
      }),
    ),
    showCacheMissNotices: Type.Optional(
      Type.Boolean({
        description: "Show cache cost and provider recovery notices.",
        default: SETTINGS_DEFAULTS.showCacheMissNotices,
      }),
    ),
    showHardwareCursor: Type.Optional(
      Type.Boolean({ description: "Show the terminal cursor while still positioning it for IME." }),
    ),
    skills: Type.Optional(SkillsInputSchema),
    steeringMode: Type.Optional(
      Type.Union([Type.Literal("all"), Type.Literal("one-at-a-time")], {
        default: SETTINGS_DEFAULTS.steeringMode,
      }),
    ),
    telemetry: Type.Optional(
      Type.Object({
        otlpEndpoint: Type.Optional(
          Type.String({
            description:
              "OTLP/HTTP base URL that receives traces, metrics, and logs, such as http://collector:4318. MSA_OTLP_ENDPOINT takes precedence. Default: the msa-grafana-lgtm podman container.",
          }),
        ),
      }),
    ),
    terminal: Type.Optional(TerminalSettingsSchema),
    theme: Type.Optional(Type.String()),
    themes: Type.Optional(
      Type.Array(Type.String(), { description: "Local theme file paths or directories." }),
    ),
    thinkingBudgets: Type.Optional(
      thinkingBudgetsSettings({
        description: "Custom token budgets for thinking levels.",
      }),
    ),
    trackingId: Type.Optional(
      Type.String({
        description: "Analytics tracking identifier, generated when analytics is enabled.",
      }),
    ),
    transport: Type.Optional(
      Type.Union(
        [
          Type.Literal("auto"),
          Type.Literal("sse"),
          Type.Literal("websocket"),
          Type.Literal("websocket-cached"),
        ],
        { default: SETTINGS_DEFAULTS.transport },
      ),
    ),
    treeFilterMode: Type.Optional(
      Type.Union(
        [
          Type.Literal("default"),
          Type.Literal("no-tools"),
          Type.Literal("user-only"),
          Type.Literal("labeled-only"),
          Type.Literal("all"),
        ],
        {
          description: "Default filter when opening /tree.",
          default: SETTINGS_DEFAULTS.treeFilterMode,
        },
      ),
    ),
    tuiMode: Type.Optional(
      Type.Union([Type.Literal("regular"), Type.Literal("fullscreen")], {
        default: SETTINGS_DEFAULTS.tuiMode,
      }),
    ),
    websocketConnectTimeoutMs: Type.Optional(
      timeoutSetting({
        description:
          'WebSocket connect or open handshake timeout in milliseconds; 0 or "disabled" disables it.',
      }),
    ),
    websockets: Type.Optional(
      Type.Boolean({ description: "Legacy setting migrated to transport.", deprecated: true }),
    ),
  },
  { additionalProperties: true },
);

type SettingsInput = Static<typeof SettingsSchema>;

export interface CompactionModelOverride extends Static<typeof CompactionModelOverrideSchema> {}
export interface CompactionSettings extends Static<typeof CompactionSettingsSchema> {}
export interface BranchSummarySettings extends Static<typeof BranchSummarySettingsSchema> {}
export interface ProviderRetrySettings extends Static<typeof ProviderRetrySettingsSchema> {}
export interface RetrySettings extends Omit<Static<typeof RetrySettingsSchema>, "maxDelayMs"> {}
export interface TerminalSettings extends Static<typeof TerminalSettingsSchema> {}
export interface ImageSettings extends Static<typeof ImageSettingsSchema> {}
export interface MemorySettings extends Static<typeof MemorySettingsSchema> {}
export interface PrWatchSettings extends Static<typeof PrWatchSettingsSchema> {}
export interface ThinkingBudgetsSettings extends Static<typeof ThinkingBudgetsSettingsSchema> {}
export type MermaidRenderingMode = NonNullable<Static<typeof MarkdownSettingsSchema>["mermaid"]>;
export interface MarkdownSettings extends Static<typeof MarkdownSettingsSchema> {}
export type CodemodeMode = Static<typeof CodemodeModeSchema>;
export interface CodemodeSettings extends Static<typeof CodemodeSettingsSchema> {}
export interface ModelPolicySettings extends Static<typeof ModelPolicySettingsSchema> {}
export type DefaultProjectTrust = NonNullable<SettingsInput["defaultProjectTrust"]>;
export type QuietStartup = NonNullable<SettingsInput["quietStartup"]>;
export type TransportSetting = NonNullable<SettingsInput["transport"]>;
export type PackageSource = Static<typeof PackageSourceSchema>;
export type FullscreenExitOutput = NonNullable<SettingsInput["fullscreenExitOutput"]>;
export type TuiMode = NonNullable<SettingsInput["tuiMode"]>;
export type CacheWarmingMode = NonNullable<SettingsInput["cacheWarming"]>;
export interface Settings extends Omit<
  SettingsInput,
  "queueMode" | "retry" | "skills" | "websockets"
> {
  retry?: RetrySettings;
  skills?: string[];
}
