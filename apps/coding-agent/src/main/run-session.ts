import tui from "@msa/tui";
import { Effect } from "effect";

import argsModule from "../cli/args.ts";
import listModelsModule from "../cli/list-models.ts";
import agentSessionRuntimeSupport from "../core/agent-session-runtime-support.ts";
import awaitingModule from "../core/awaiting.ts";
import httpDispatcher from "../core/http-dispatcher.ts";
import timings from "../core/timings.ts";
import migrations from "../migrations.ts";
import themeModule from "../modes/interactive/theme/theme.ts";
import cliInput from "./cli-input.ts";
import RuntimeFactory from "./runtime-factory.ts";
import type startupModule from "./startup.ts";

const { setCapabilityOverrides, primeTerminalCapabilities } = tui;
const { printHelp } = argsModule;
const { listModels } = listModelsModule;
const { createAgentSessionRuntime } = agentSessionRuntimeSupport;
const { awaited, awaiting } = awaitingModule;
const { configureHttpDispatcher, applyHttpProxySettings } = httpDispatcher;
const { time } = timings;
const { showDeprecationWarnings } = migrations;
const { initTheme } = themeModule;
const { prepareInitialMessage, readPipedStdin, reportDiagnostics } = cliInput;

type Startup = Awaited<ReturnType<(typeof startupModule)["prepareStartup"]>>;
type Runtime = Awaited<ReturnType<typeof createAgentSessionRuntime>>;

function startRuntime(startup: Startup): Promise<Runtime> {
  return Effect.runPromise(
    awaiting(function* () {
      const factory = new RuntimeFactory(startup);
      time("createRuntime");
      const { agentDir, sessionManager, telemetry } = startup;
      const runtime = yield* awaited(
        createAgentSessionRuntime(factory.create, {
          agentDir,
          cwd: sessionManager.getCwd(),
          sessionManager,
          ...(telemetry === undefined ? {} : { telemetry }),
        }),
      );
      time("createAgentSessionRuntime");
      const { settingsManager } = runtime.services;
      setCapabilityOverrides(settingsManager.terminal.getTerminalCapabilityOverrides());
      if (startup.appMode === "interactive")
        yield* awaited(Effect.runPromise(primeTerminalCapabilities));
      applyHttpProxySettings(settingsManager.getGlobalSettings().httpProxy);
      configureHttpDispatcher(settingsManager.session.getHttpIdleTimeoutMs());
      return runtime;
    }),
  );
}

function exitForMetadataCommands(startup: Startup, runtime: Runtime): Promise<void> {
  return Effect.runPromise(
    awaiting(function* () {
      const { parsed, startupSettingsDiagnostics } = startup;
      const { resourceLoader, modelRuntime } = runtime.services;
      if (parsed.help === true) {
        reportDiagnostics(startupSettingsDiagnostics);
        printHelp(
          resourceLoader
            .getExtensions()
            .extensions.flatMap((extension) => Array.from(extension.flags.values())),
        );
        process.exit(0);
      }
      if (parsed.listModels !== undefined) {
        reportDiagnostics(startupSettingsDiagnostics);
        const searchPattern = typeof parsed.listModels === "string" ? parsed.listModels : undefined;
        yield* awaited(listModels(modelRuntime, searchPattern, AbortSignal.timeout(15_000)));
        process.exit(0);
      }
    }),
  );
}

function prepareInput(startup: Startup, runtime: Runtime) {
  return Effect.runPromise(
    awaiting(function* () {
      let stdinContent: string | undefined;
      if (startup.appMode !== "rpc") {
        stdinContent = yield* awaited(readPipedStdin());
        if (stdinContent !== undefined && startup.appMode === "interactive")
          startup.appMode = "print";
      }
      time("readPipedStdin");
      const input = yield* awaited(prepareInitialMessage(startup.parsed, stdinContent));
      time("prepareInitialMessage");
      initTheme(
        runtime.services.settingsManager.display.getTheme(),
        startup.appMode === "interactive",
      );
      time("initTheme");
      if (startup.appMode === "interactive" && startup.deprecationWarnings.length > 0) {
        yield* awaited(showDeprecationWarnings(startup.deprecationWarnings));
      }
      return input;
    }),
  );
}

const runSession = { exitForMetadataCommands, prepareInput, startRuntime };

export default runSession;
