import { DEFAULT_MAX_AGENT_RETRY_DELAY_MS } from "@msa/ai/utils/retry";

export const SETTINGS_DEFAULTS = {
  transport: "auto",
  steeringMode: "one-at-a-time",
  followUpMode: "one-at-a-time",
  compaction: {
    enabled: true,
    reserveTokens: 16384,
    keepRecentTokens: 20000,
  },
  branchSummary: {
    reserveTokens: 16384,
    skipPrompt: false,
  },
  retry: {
    enabled: true,
    maxRetries: 3,
    baseDelayMs: 2000,
    maxAgentDelayMs: DEFAULT_MAX_AGENT_RETRY_DELAY_MS,
    provider: {
      maxRetryDelayMs: 60000,
    },
  },
  orchestrator: {
    maxConcurrentThreads: 4,
  },
  hideThinkingBlock: true,
  showCacheMissNotices: false,
  quietStartup: false,
  defaultProjectTrust: "ask",
  collapseChangelog: false,
  enableInstallTelemetry: true,
  enableAnalytics: false,
  enableSkillCommands: true,
  terminal: {
    showImages: true,
    imageWidthCells: 60,
    clearOnShrink: false,
    showTerminalProgress: false,
  },
  images: {
    autoResize: true,
    blockImages: false,
  },
  memory: {
    enabled: true,
    embedding: {
      enabled: true,
      baseUrl: "http://127.0.0.1:11434/v1",
      model: "embeddinggemma-2",
      queryPrefix: "task: search result | query: ",
      documentPrefix: "title: none | text: ",
      timeoutMs: 5000,
    },
    recall: {
      enabled: true,
      limit: 5,
      minScore: 0.72,
    },
  },
  doubleEscapeAction: "tree",
  treeFilterMode: "default",
  editorPaddingX: 0,
  outputPad: 1,
  autocompleteMaxVisible: 5,
  markdown: {
    codeBlockIndent: "  ",
    mermaid: "streaming",
  },
  codemode: {
    mode: "on",
    inlineBudget: 3000,
  },
  prWatch: {
    intervalSeconds: 45,
    statusIntervalSeconds: 300,
  },
  cacheWarming: "streaming",
  tuiMode: "fullscreen",
  fullscreenExitOutput: "transcript",
  fullscreenScrollbar: "auto",
  fullscreenCopyOnSelect: true,
  fullscreenWheelScrollLines: "auto",
} as const;
