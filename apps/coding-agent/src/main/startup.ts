import { Effect } from "effect";

import awaitingModule from "../core/awaiting.ts";
import settingsDiagnostics from "../core/settings-diagnostics.ts";
import SettingsManager from "../core/settings-manager.ts";
import timings from "../core/timings.ts";
import migrations from "../migrations.ts";
import cliArgs from "./cli-args.ts";
import type mainInternalTypes from "./main-internal.types.ts";
import sessionSetup from "./session-setup.ts";
import startupServices from "./startup-services.ts";

const { awaited, awaiting } = awaitingModule;
const { collectSettingsDiagnostics } = settingsDiagnostics;
const { time } = timings;
const { runMigrations } = migrations;
const { parseCliArgs } = cliArgs;
const { prepareSession } = sessionSetup;
const { setUpInteractiveStart, startTelemetryFor } = startupServices;

type Boot = mainInternalTypes.Boot;

function prepareStartup(args: string[], boot: Boot) {
  return Effect.runPromise(
    awaiting(function* () {
      const { cwd, agentDir } = boot;
      const { appMode, parsed } = yield* parseCliArgs(args);
      const { migratedAuthProviders: migratedProviders, deprecationWarnings } = yield* awaited(
        runMigrations(cwd),
      );
      time("runMigrations");
      const startupSettingsManager = yield* awaited(SettingsManager.create(cwd, agentDir));
      const startupSettingsDiagnostics = collectSettingsDiagnostics(startupSettingsManager);
      yield* awaited(setUpInteractiveStart(appMode, parsed, startupSettingsManager));
      const telemetry = yield* awaited(startTelemetryFor(parsed, startupSettingsManager));
      time("startTelemetry");
      const session = yield* prepareSession(parsed, startupSettingsManager, cwd, appMode, agentDir);
      return {
        ...boot,
        ...session,
        appMode,
        deprecationWarnings,
        migratedProviders,
        parsed,
        startupSettingsDiagnostics,
        startupSettingsManager,
        telemetry,
      };
    }),
  );
}

const startup = { prepareStartup };

export default startup;
