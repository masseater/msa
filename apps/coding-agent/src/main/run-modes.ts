import { Effect } from "effect";

import awaitingModule from "../core/awaiting.ts";
import outputGuard from "../core/output-guard.ts";
import timings from "../core/timings.ts";
import modes from "../modes/index.ts";
import themeModule from "../modes/interactive/theme/theme.ts";
import interop from "../utils/interop.ts";
import cliInput from "./cli-input.ts";
import type runSession from "./run-session.ts";
import type startupChecks from "./startup-checks.ts";
import type startupModule from "./startup.ts";

const { awaited, awaiting, performed } = awaitingModule;
const { restoreStdout } = outputGuard;
const { printTimings, time } = timings;
const { runPrintMode, InteractiveMode, runRpcMode } = modes;
const { stopThemeWatcher } = themeModule;
const { callbackPromise } = interop;
const { toPrintOutputMode } = cliInput;

type Startup = Awaited<ReturnType<(typeof startupModule)["prepareStartup"]>>;
type Runtime = Awaited<ReturnType<(typeof runSession)["startRuntime"]>>;
type Input = Awaited<ReturnType<(typeof runSession)["prepareInput"]>>;
type Checks = ReturnType<(typeof startupChecks)["checkStartup"]>;

function drain(stream: NodeJS.WriteStream): Promise<void> {
  if (stream.writableLength === 0) return Promise.resolve();
  return callbackPromise<void>((resolve) => stream.once("drain", resolve));
}

function runInteractive(startup: Startup, runtime: Runtime, input: Input, checks: Checks) {
  return Effect.runPromise(
    awaiting(function* () {
      const { parsed } = startup;
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
