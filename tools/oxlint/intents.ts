import { builtinModules } from "node:module";

import localTimeRules from "../../local-time-rules.config.ts";
import scriptIoRules from "../../script-io-rules.config.ts";
import intentRule from "./intent-rule.ts";

const { defineIntentRule } = intentRule;

const ENV_ONLY_VIA_PROCESS_ENV =
  "環境変数は core/platform の readEnv・writeEnv・envSnapshot だけで扱う";
const NODE_BUILTINS_VIA_PLATFORM = "node の組み込みは core/platform/node/ を通して使う";
const TIMERS_ARMED_BY_THE_RUN =
  "タイマーはプロセス全体で数えず、@msa/testing の timersArmedBy で計測する処理が張ったものだけを数える";

const ioModules: readonly string[] = [
  "bun",
  "child_process",
  "cluster",
  "effect/Console",
  "effect/FileSystem",
  "effect/Stdio",
  "effect/Terminal",
  "fs",
  "fs/promises",
  "node:child_process",
  "node:cluster",
  "node:fs",
  "node:fs/promises",
  "node:worker_threads",
  "worker_threads",
];

const ioPackages: readonly string[] = [
  "effect/process",
  "@effect/platform-bun",
  "@effect/platform-node",
  "@effect/platform-node-shared",
];

const ioEffectMembers: readonly string[] = ["Console", "FileSystem", "Stdio", "Terminal"];

const localDateMembers: readonly string[] = [
  "getDate",
  "getDay",
  "getFullYear",
  "getHours",
  "getMilliseconds",
  "getMinutes",
  "getMonth",
  "getSeconds",
  "getTimezoneOffset",
  "getYear",
  "toDateString",
  "toLocaleDateString",
  "toLocaleTimeString",
  "toTimeString",
];

const envViaPlatform = defineIntentRule({
  imports: [{ modules: ["node:process", "process"], names: ["env"] }],
  members: [],
  message: ENV_ONLY_VIA_PROCESS_ENV,
});

const nodeBuiltinsViaPlatform = defineIntentRule({
  imports: [{ modules: builtinModules, prefixes: ["node:"] }],
  members: [],
  message: NODE_BUILTINS_VIA_PLATFORM,
});

const scriptIoViaScriptOutput = defineIntentRule({
  imports: [
    { modules: ioModules },
    { modules: ["effect"], names: ioEffectMembers },
    ...ioPackages.map((name) => ({ modules: [name], prefixes: [`${name}/`] })),
  ],
  members: [{ object: "process", properties: ["stdout", "stderr"] }],
  message: scriptIoRules.message,
});

const timersArmedByTheRun = defineIntentRule({
  imports: [],
  members: [{ properties: ["getActiveResourcesInfo"] }],
  message: TIMERS_ARMED_BY_THE_RUN,
});

const localTimeViaChord = defineIntentRule({
  imports: [],
  members: [{ properties: localDateMembers }, { object: "Intl", properties: ["DateTimeFormat"] }],
  message: localTimeRules.message,
});

const intents = {
  envViaPlatform,
  localTimeViaChord,
  nodeBuiltinsViaPlatform,
  scriptIoViaScriptOutput,
  timersArmedByTheRun,
};

export default intents;
