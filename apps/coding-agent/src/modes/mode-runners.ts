import type InteractiveModeClass from "./interactive/interactive-mode.ts";
import printMode from "./print-mode.ts";
import rpcMode from "./rpc/rpc-mode.ts";

const loadInteractiveMode = (): Promise<typeof InteractiveModeClass> =>
  import("./interactive/interactive-mode.ts").then((module) => module.default);

const modeRunners = {
  loadInteractiveMode,
  runPrintMode: printMode.runPrintMode,
  runRpcMode: rpcMode.runRpcMode,
};

export default modeRunners;
