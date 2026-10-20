import modelSchema from "@msa/ai/providers/model-schema";
import { Type } from "typebox";

import settingsDefaults from "./settings-defaults.ts";
import settingsSchemaPart1 from "./settings-schema-part1.ts";
import settingsSchemaPart2 from "./settings-schema-part2.ts";

const { SETTINGS_DEFAULTS } = settingsDefaults;
const {
  BranchSummarySettingsSchema,
  CodemodeSettingsSchema,
  CompactionSettingsSchema,
  ImageSettingsSchema,
  MarkdownSettingsSchema,
  MemorySettingsSchema,
  RetrySettingsSchema,
  TerminalSettingsSchema,
  thinkingBudgetsSettings,
  timeoutSetting,
} = settingsSchemaPart1;
const { ModelThinkingLevelSchema } = modelSchema;
const { ModelPolicySettingsSchema, PackageSourceSchema, PrWatchSettingsSchema, SkillsInputSchema } =
  settingsSchemaPart2;

const SettingsSchema = Type.Object(
  {
    $schema: Type.Optional(Type.String({ description: "JSON Schema reference." })),
    autocompleteMaxVisible: Type.Optional(
      Type.Number({
        default: SETTINGS_DEFAULTS.autocompleteMaxVisible,
        description: "Maximum visible items in the autocomplete dropdown.",
      }),
    ),
    branchSummary: Type.Optional(BranchSummarySettingsSchema),
    cacheWarming: Type.Optional(
      Type.Union([Type.Literal("off"), Type.Literal("streaming"), Type.Literal("idle")], {
        default: SETTINGS_DEFAULTS.cacheWarming,
        description:
          'Cache-warming profile. "idle" also warms between agent runs. Global only because each refresh costs money.',
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
        default: SETTINGS_DEFAULTS.collapseChangelog,
        description:
          "Show the condensed changelog after update; use /release-notes for the full changelog.",
      }),
    ),
    compaction: Type.Optional(CompactionSettingsSchema),
    defaultModel: Type.Optional(Type.String()),
    defaultProjectTrust: Type.Optional(
      Type.Union([Type.Literal("ask"), Type.Literal("always"), Type.Literal("never")], {
        default: SETTINGS_DEFAULTS.defaultProjectTrust,
        description: "Global setting only.",
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
        default: SETTINGS_DEFAULTS.doubleEscapeAction,
        description: "Action for double-escape with an empty editor.",
      }),
    ),
    editorPaddingX: Type.Optional(
      Type.Number({
        default: SETTINGS_DEFAULTS.editorPaddingX,
        description: "Horizontal padding for the input editor.",
      }),
    ),
    enableAnalytics: Type.Optional(
      Type.Boolean({
        default: SETTINGS_DEFAULTS.enableAnalytics,
        description: "Opt in to analytics data sharing.",
      }),
    ),
    enableInstallTelemetry: Type.Optional(
      Type.Boolean({
        default: SETTINGS_DEFAULTS.enableInstallTelemetry,
        description: "Send attribution headers to OpenRouter.",
      }),
    ),
    enableSkillCommands: Type.Optional(
      Type.Boolean({
        default: SETTINGS_DEFAULTS.enableSkillCommands,
        description: "Register skills as /name commands.",
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
        default: SETTINGS_DEFAULTS.fullscreenCopyOnSelect,
        description: "No effect in regular TUI mode.",
      }),
    ),
    fullscreenExitOutput: Type.Optional(
      Type.Union([Type.Literal("transcript"), Type.Literal("resume-hint")], {
        default: SETTINGS_DEFAULTS.fullscreenExitOutput,
        description: "No effect in regular TUI mode.",
      }),
    ),
    fullscreenScrollbar: Type.Optional(
      Type.Union([Type.Literal("auto"), Type.Literal("always"), Type.Literal("hidden")], {
        default: SETTINGS_DEFAULTS.fullscreenScrollbar,
        description: "No effect in regular TUI mode.",
      }),
    ),
    fullscreenWheelScrollLines: Type.Optional(
      Type.Union([Type.Number(), Type.Literal("auto")], {
        default: SETTINGS_DEFAULTS.fullscreenWheelScrollLines,
        description:
          "Lines scrolled per wheel event in fullscreen mode; numeric values are clamped from 1 to 100.",
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
        maxConcurrentThreads: Type.Optional(
          Type.Integer({
            default: SETTINGS_DEFAULTS.orchestrator.maxConcurrentThreads,
            minimum: 1,
          }),
        ),
        reviewModel: Type.Optional(
          Type.String({
            description:
              'Model of the review thread that closes each round, as "provider/id". Default: the orchestrator\'s model.',
          }),
        ),
        reviewThinkingLevel: Type.Optional(ModelThinkingLevelSchema),
        workerModel: Type.Optional(
          Type.String({
            description:
              'Model of the threads the orchestrator starts, as "provider/id", unless create_task names one. Default: the orchestrator\'s model.',
          }),
        ),
        workerThinkingLevel: Type.Optional(ModelThinkingLevelSchema),
      }),
    ),
    outputPad: Type.Optional(
      Type.Union([Type.Literal(0), Type.Literal(1)], {
        default: SETTINGS_DEFAULTS.outputPad,
        description: "Horizontal padding for transcript content.",
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
        deprecated: true,
        description: "Legacy setting migrated to steeringMode.",
      }),
    ),
    quietStartup: Type.Optional(
      Type.Union([Type.Boolean(), Type.Literal("header")], {
        default: SETTINGS_DEFAULTS.quietStartup,
        description:
          'When true, hide all startup output. When "header", keep only the startup header.',
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
        default: SETTINGS_DEFAULTS.showCacheMissNotices,
        description: "Show cache cost and provider recovery notices.",
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
          default: SETTINGS_DEFAULTS.treeFilterMode,
          description: "Default filter when opening /tree.",
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
      Type.Boolean({ deprecated: true, description: "Legacy setting migrated to transport." }),
    ),
  },
  { additionalProperties: true },
);

const settingsSchemaPart3Part1 = {
  SettingsSchema,
};

export default settingsSchemaPart3Part1;
