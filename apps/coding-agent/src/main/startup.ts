import { Effect } from "effect";

import startupUi from "../cli/startup-ui.ts";
import config from "../config.ts";
import awaitingModule from "../core/awaiting.ts";
import telemetrySupport from "../core/observability/telemetry-support.ts";
import processEnv from "../core/process-env.ts";
import settingsDiagnostics from "../core/settings-diagnostics.ts";
import SettingsManager from "../core/settings-manager.ts";
import timings from "../core/timings.ts";
import migrations from "../migrations.ts";
import type bootstrapModule from "./bootstrap.ts";
import cliInput from "./cli-input.ts";
import sessionSetup from "./session-setup.ts";

const { awaited, awaiting } = awaitingModule;
const { ENV_SESSION_DIR, VERSION } = config;
const { showFirstTimeSetup, shouldRunFirstTimeSetup } = startupUi;
const { startTelemetry } = telemetrySupport;
const { readEnv } = processEnv;
const { collectSettingsDiagnostics } = settingsDiagnostics;
const { time } = timings;
const { runMigrations } = migrations;
const { parseCliArgs } = cliInput;
const { prepareSession } = sessionSetup;

type Boot = NonNullable<Awaited<ReturnType<(typeof bootstrapModule)["bootstrap"]>>>;

function startTelemetryFor(
  parsed: { help?: boolean | undefined; listModels?: string | boolean | undefined },
  settingsManager: SettingsManager,
) {
  if (parsed.help === true || parsed.listModels !== undefined) return Promise.resolve(undefined);
  return startTelemetry({
    envEndpoint: readEnv("MSA_OTLP_ENDPOINT"),
    path: readEnv("PATH"),
    settingsEndpoint: settingsManager.telemetry.getOtlpEndpoint(),
    version: VERSION,
  });
}

function prepareStartup(args: string[], boot: Boot) {
  return Effect.runPromise(
    awaiting(function* () {
      const { cwd, agentDir } = boot;
      const { appMode, parsed } = yield* parseCliArgs(args);
      const { migratedAuthProviders: migratedProviders, deprecationWarnings } = runMigrations(cwd);
      time("runMigrations");
      const startupSettingsManager = SettingsManager.create(cwd, agentDir);
      const startupSettingsDiagnostics = collectSettingsDiagnostics(startupSettingsManager);
      const interactive = appMode === "interactive";
      if (
        interactive &&
        parsed.help !== true &&
        parsed.listModels === undefined &&
        shouldRunFirstTimeSetup()
      ) {
        yield* awaited(showFirstTimeSetup(startupSettingsManager));
        time("firstTimeSetup");
      }
      if (interactive && parsed.useTheme !== undefined) {
        startupSettingsManager.applyOverrides({ theme: parsed.useTheme });
      }
      const telemetry = yield* awaited(startTelemetryFor(parsed, startupSettingsManager));
      time("startTelemetry");
      const session = yield* prepareSession(
        parsed,
        readEnv(ENV_SESSION_DIR),
        startupSettingsManager,
        cwd,
        appMode,
        agentDir,
      );
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
