import retryModule from "@msa/ai/utils/retry";

const { DEFAULT_MAX_AGENT_RETRY_DELAY_MS } = retryModule;

const SETTINGS_DEFAULTS = {
  autocompleteMaxVisible: 5,
  branchSummary: {
    reserveTokens: 16384,
    skipPrompt: false,
  },
  cacheWarming: "streaming",
  codemode: {
    inlineBudget: 3000,
    mode: "on",
  },
  collapseChangelog: false,
  compaction: {
    enabled: true,
    keepRecentTokens: 20000,
    reserveTokens: 16384,
  },
  defaultProjectTrust: "ask",
  doubleEscapeAction: "tree",
  editorPaddingX: 0,
  enableAnalytics: false,
  enableInstallTelemetry: true,
  enableSkillCommands: true,
  followUpMode: "one-at-a-time",
  fullscreenCopyOnSelect: true,
  fullscreenExitOutput: "transcript",
  fullscreenScrollbar: "auto",
  fullscreenWheelScrollLines: "auto",
  hideThinkingBlock: true,
  images: {
    autoResize: true,
    blockImages: false,
  },
  markdown: {
    codeBlockIndent: "  ",
    mermaid: "streaming",
  },
  memory: {
    embedding: {
      baseUrl: "http://127.0.0.1:11434/v1",
      documentPrefix: "title: none | text: ",
      enabled: true,
      model: "embeddinggemma-2",
      queryPrefix: "task: search result | query: ",
      timeoutMs: 5000,
    },
    enabled: true,
    recall: {
      enabled: true,
      limit: 5,
      minScore: 0.72,
    },
  },
  orchestrator: {
    maxConcurrentThreads: 4,
  },
  outputPad: 1,
  prWatch: {
    intervalSeconds: 45,
    statusIntervalSeconds: 300,
  },
  quietStartup: false,
  retry: {
    baseDelayMs: 2000,
    enabled: true,
    maxAgentDelayMs: DEFAULT_MAX_AGENT_RETRY_DELAY_MS,
    maxRetries: 3,
    provider: {
      maxRetryDelayMs: 60000,
    },
  },
  showCacheMissNotices: false,
  steeringMode: "one-at-a-time",
  terminal: {
    clearOnShrink: false,
    imageWidthCells: 60,
    showImages: true,
    showTerminalProgress: false,
  },
  transport: "auto",
  treeFilterMode: "default",
  tuiMode: "fullscreen",
} as const;

const settingsDefaults = {
  SETTINGS_DEFAULTS,
};

export default settingsDefaults;
