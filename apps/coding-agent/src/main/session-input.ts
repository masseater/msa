import { Effect } from "effect";

import argsModule from "../cli/args.ts";
import listModelsModule from "../cli/list-models.ts";
import awaitingModule from "../core/awaiting.ts";
import timings from "../core/timings.ts";
import migrations from "../migrations.ts";
import themeModule from "../modes/interactive/theme/theme.ts";
import cliInput from "./cli-input.ts";
import diagnosticsModule from "./diagnostics.ts";
import type mainInternalTypes from "./main-internal.types.ts";

const { printHelp } = argsModule;
const { listModels } = listModelsModule;
const { awaited, awaiting } = awaitingModule;
const { time } = timings;
const { showDeprecationWarnings } = migrations;
const { initTheme, refreshCustomThemes } = themeModule;
const { prepareInitialMessage, readPipedStdin } = cliInput;
const { reportDiagnostics } = diagnosticsModule;

type Startup = mainInternalTypes.Startup;
type Runtime = mainInternalTypes.Runtime;

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
      yield* awaited(refreshCustomThemes());
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

const sessionInput = { exitForMetadataCommands, prepareInput };

export default sessionInput;
