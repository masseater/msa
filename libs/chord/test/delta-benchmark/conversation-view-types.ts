import conversationViewModel from "./conversation-view-model.ts";
import type conversationViewModelTypes from "./conversation-view-model.types.ts";
import type conversationViewTypes from "./conversation-view-types.types.ts";

const { modes, scenarios } = conversationViewModel;

const MiB = 1024 * 1024;
const MOUNTED_KEYS = ["config", "inbox", "turn", "preferences", "live"] as const;
const DOCUMENT_WATCH_KEYS = ["config", "inbox", "preferences", "live"] as const;

const standard: conversationViewTypes.ScenarioConfig = {
  conversationWatchCount: 1,
  documentWatchCount: 4,
  queueCapacity: undefined,
  started: true,
};

const scenarioConfig = (
  name: conversationViewModelTypes.Scenario,
  overflowCapacity: number,
): conversationViewTypes.ScenarioConfig => {
  switch (name) {
    case "projection-control":
      return { ...standard, conversationWatchCount: 0, documentWatchCount: 0 };
    case "normal":
    case "churn-reconnect":
      return standard;
    case "fanout":
      return { ...standard, conversationWatchCount: 8, documentWatchCount: 16 };
    case "delayed-start-lag":
    case "branch-head-replacement":
      return { ...standard, started: false };
    case "overflow-reset":
      return { ...standard, queueCapacity: overflowCapacity, started: false };
  }
};

const isMode = (value: string | undefined): value is conversationViewModelTypes.Mode =>
  (modes as readonly (string | undefined)[]).includes(value);

const isScenario = (value: string | undefined): value is conversationViewModelTypes.Scenario =>
  (scenarios as readonly (string | undefined)[]).includes(value);

const positive = (value: number, message: string): number => {
  if (!Number.isSafeInteger(value) || value < 1) throw new RangeError(message);
  return value;
};

const parseWorkerArguments = (argv: readonly string[]): conversationViewTypes.WorkerArguments => {
  const [mode, scenario] = [argv[2], argv[3]];
  if (!isMode(mode)) throw new Error(`Unknown mode ${mode}`);
  if (!isScenario(scenario)) throw new Error(`Unknown scenario ${scenario}`);
  const headlineEntries = positive(Number(argv[4] ?? 512), "Invalid entry count");
  const commitTarget = positive(Number(argv[5] ?? 1_000), "Invalid commit count");
  const trial = Number(argv[6] ?? 0);
  const capacity = positive(Number(argv[7] ?? 256), "Invalid queue operation capacity");
  return {
    commitTarget,
    config: scenarioConfig(scenario, capacity),
    headlineEntries,
    mode,
    scenario,
    trial,
  };
};

const conversationViewModuleTypes = {
  DOCUMENT_WATCH_KEYS,
  MOUNTED_KEYS,
  MiB,
  parseWorkerArguments,
};

export default conversationViewModuleTypes;
