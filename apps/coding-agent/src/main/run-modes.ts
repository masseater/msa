import { Effect } from "effect";

import awaitingModule from "../core/awaiting.ts";
import KeybindingsManager from "../core/keybindings-manager.ts";
import outputGuard from "../core/output-guard.ts";
import timings from "../core/timings.ts";
import themeModule from "../modes/interactive/theme/theme.ts";
import modeRunners from "../modes/mode-runners.ts";
import interop from "../utils/interop.ts";
import appModeModule from "./app-mode.ts";
import type mainInternalTypes from "./main-internal.types.ts";

const { awaited, awaiting, performed } = awaitingModule;
const { restoreStdout } = outputGuard;
const { printTimings, time } = timings;
const { loadInteractiveMode, runPrintMode, runRpcMode } = modeRunners;
const { stopThemeWatcher } = themeModule;
const { callbackPromise } = interop;
const { toPrintOutputMode } = appModeModule;

type Startup = mainInternalTypes.Startup;
type Runtime = mainInternalTypes.Runtime;
type Input = mainInternalTypes.Input;
type Checks = mainInternalTypes.Checks;

function drain(stream: NodeJS.WriteStream): Promise<void> {
  if (stream.writableLength === 0) return Promise.resolve();
  return callbackPromise<void>((resolve) => stream.once("drain", resolve));
}

function runInteractive(startup: Startup, runtime: Runtime, input: Input, checks: Checks) {
  return Effect.runPromise(
    awaiting(function* () {
      const { parsed } = startup;
      const [InteractiveMode] = yield* awaited(
        Promise.all([loadInteractiveMode(), KeybindingsManager.refresh()]),
      );
      const interactiveMode = new InteractiveMode(runtime, {
        autoTrustOnReloadCwd: startup.autoTrustOnReloadCwd,
        initialImages: input.initialImages,
        initialMessage: input.initialMessage,
        initialMessages: parsed.messages,
        initialThemeSetting: parsed.useTheme,
        migratedProviders: startup.migratedProviders,
        modelFallbackMessage: runtime.modelFallbackMessage,
        startupDiagnostics: checks.startupDiagnostics,
        tuiMode: parsed.tuiMode,
        verbose: parsed.verbose,
      });
      if (!checks.startupBenchmark) {
        printTimings();
        yield* awaited(interactiveMode.lifecycle.runLoop.run());
        return;
      }
      yield* awaited(interactiveMode.lifecycle.startup.init());
      time("interactiveMode.init");
      yield* performed(Effect.sleep(150));
      interactiveMode.lifecycle.shutdown.stop();
      stopThemeWatcher();
      printTimings();
      yield* awaited(drain(process.stdout));
      yield* awaited(drain(process.stderr));
    }),
  );
}

function runPrint(startup: Startup, runtime: Runtime, input: Input) {
  return Effect.runPromise(
    awaiting(function* () {
      printTimings();
      const exitCode = yield* awaited(
        runPrintMode(runtime, {
          initialImages: input.initialImages,
          initialMessage: input.initialMessage,
          messages: startup.parsed.messages,
          mode: toPrintOutputMode(startup.appMode),
        }),
      );
      stopThemeWatcher();
      restoreStdout();
      if (exitCode !== 0) process.exitCode = exitCode;
    }),
  );
}

function runMode(startup: Startup, runtime: Runtime, input: Input, checks: Checks): Promise<void> {
  if (!startup.offlineMode && startup.appMode === "rpc") {
    void runtime.services.modelRuntime
      .refresh({ signal: AbortSignal.timeout(15_000) })
      .catch(() => {});
  }
  if (startup.appMode === "rpc") {
    printTimings();
    return runRpcMode(runtime);
  }
  if (startup.appMode === "interactive") return runInteractive(startup, runtime, input, checks);
  return runPrint(startup, runtime, input);
}

const runModes = { runMode };

export default runModes;
