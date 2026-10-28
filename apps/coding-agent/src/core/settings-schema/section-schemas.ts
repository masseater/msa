import { type TSchemaOptions, Type } from "typebox";

import settingsDefaults from "../settings-defaults.ts";

const { SETTINGS_DEFAULTS } = settingsDefaults;

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
      default: SETTINGS_DEFAULTS.retry.provider.maxRetryDelayMs,
      description: "Maximum server-requested delay before failing.",
    }),
  ),
  timeoutMs: Type.Optional(
    Type.Number({ description: "SDK or provider request timeout in milliseconds." }),
  ),
});

const RetrySettingsSchema = Type.Object({
  baseDelayMs: Type.Optional(
    Type.Number({
      default: SETTINGS_DEFAULTS.retry.baseDelayMs,
      description: "Exponential backoff base delay in milliseconds: 2s, 4s, 8s.",
    }),
  ),
  enabled: Type.Optional(Type.Boolean({ default: SETTINGS_DEFAULTS.retry.enabled })),
  maxAgentDelayMs: Type.Optional(Type.Number({ default: SETTINGS_DEFAULTS.retry.maxAgentDelayMs })),
  maxDelayMs: Type.Optional(
    Type.Number({
      deprecated: true,
      description: "Legacy retry delay setting. Use provider.maxRetryDelayMs instead.",
    }),
  ),
  maxRetries: Type.Optional(Type.Number({ default: SETTINGS_DEFAULTS.retry.maxRetries })),
  provider: Type.Optional(ProviderRetrySettingsSchema),
});

const TerminalSettingsSchema = Type.Object({
  clearOnShrink: Type.Optional(
    Type.Boolean({
      default: SETTINGS_DEFAULTS.terminal.clearOnShrink,
      description: "Clear empty rows when content shrinks.",
    }),
  ),
  hyperlinks: Type.Optional(Type.Union([Type.Boolean(), Type.Literal("auto")])),
  imageWidthCells: Type.Optional(
    Type.Number({
      default: SETTINGS_DEFAULTS.terminal.imageWidthCells,
      description: "Preferred inline image width in terminal cells.",
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
      default: SETTINGS_DEFAULTS.terminal.showImages,
      description: "Show images when the terminal supports them.",
    }),
  ),
  showTerminalProgress: Type.Optional(
    Type.Boolean({
      default: SETTINGS_DEFAULTS.terminal.showTerminalProgress,
      description: "Show OSC 9;4 terminal progress indicators.",
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

const MemoryRecallSettingsSchema = Type.Object({
  enabled: Type.Optional(
    Type.Boolean({
      default: SETTINGS_DEFAULTS.memory.recall.enabled,
      description: "Ask sepiace for memories relevant to each user prompt and add them to the run.",
    }),
  ),
});

const MemorySettingsSchema = Type.Object({
  enabled: Type.Optional(
    Type.Boolean({
      default: SETTINGS_DEFAULTS.memory.enabled,
      description:
        "Long-term memory in sepiace: the connection to sepiace, the memory tool, recall, and the /memory command.",
    }),
  ),
  recall: Type.Optional(MemoryRecallSettingsSchema),
  url: Type.Optional(
    Type.String({
      description:
        "The sepiace MCP endpoint memory connects to. Read only from the global settings.json.",
    }),
  ),
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
      default: SETTINGS_DEFAULTS.codemode.inlineBudget,
      description: "Estimated tokens available for inline codemode tool declarations.",
      minimum: 0,
    }),
  ),
  mode: Type.Optional(
    codemodeMode({
      default: SETTINGS_DEFAULTS.codemode.mode,
      description:
        'How codemode presents tools. "on" keeps direct tools declared and annotates tools callable from scripts; codemode lists only tools without direct exposure. "only" lists every script-callable tool in codemode and does not declare active direct tools.',
    }),
  ),
});

const sectionSchemas = {
  BranchSummarySettingsSchema,
  CodemodeModeSchema,
  CodemodeSettingsSchema,
  CompactionModelOverrideSchema,
  CompactionSettingsSchema,
  ImageSettingsSchema,
  MarkdownSettingsSchema,
  MemorySettingsSchema,
  ProviderRetrySettingsSchema,
  RetrySettingsSchema,
  TerminalSettingsSchema,
  ThinkingBudgetsSettingsSchema,
  thinkingBudgetsSettings,
  timeoutSetting,
};

export default sectionSchemas;
