import { Effect } from "effect";

import type argsTypes from "../cli/args.types.ts";
import startupUi from "../cli/startup-ui.ts";
import config from "../config.ts";
import awaitingModule from "../core/awaiting.ts";
import telemetrySupport from "../core/observability/telemetry-support.ts";
import processEnv from "../core/process-env.ts";
import type SettingsManager from "../core/settings-manager.ts";
import timings from "../core/timings.ts";

const { showFirstTimeSetup, shouldRunFirstTimeSetup } = startupUi;
const { VERSION } = config;
const { awaited, awaiting } = awaitingModule;
const { startTelemetry } = telemetrySupport;
const { readEnv } = processEnv;
const { time } = timings;

function setUpInteractiveStart(
  appMode: string,
  parsed: argsTypes.Args,
  settingsManager: SettingsManager,
): Promise<void> {
  return Effect.runPromise(
    awaiting(function* () {
      if (appMode !== "interactive") return;
      if (parsed.help !== true && parsed.listModels === undefined && shouldRunFirstTimeSetup()) {
        yield* awaited(showFirstTimeSetup(settingsManager));
        time("firstTimeSetup");
      }
      if (parsed.useTheme !== undefined) settingsManager.applyOverrides({ theme: parsed.useTheme });
    }),
  );
}

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

const startupServices = { setUpInteractiveStart, startTelemetryFor };

export default startupServices;
