import { Effect } from "effect";

import config from "../config.ts";
import awaitingModule from "../core/awaiting.ts";
import httpDispatcher from "../core/http-dispatcher.ts";
import processEnv from "../core/process-env.ts";
import SettingsManager from "../core/settings-manager.ts";
import timings from "../core/timings.ts";
import extensionsModule from "../extensions/index.ts";
import type mainTypes from "../main.types.ts";
import themeSchema from "../modes/interactive/theme/theme-schema.ts";
import themeModule from "../modes/interactive/theme/theme.ts";
import windowsSelfUpdate from "../utils/windows-self-update.ts";
import cliInput from "./cli-input.ts";
import runAuthCommandModule from "./run-auth-command.ts";
import subcommands from "./subcommands.ts";

const { awaited, awaiting } = awaitingModule;
const { getAgentDir, getPackageDir } = config;
const { configureHttpDispatcher, applyHttpProxySettings } = httpDispatcher;
const { writeEnv, readEnv } = processEnv;
const { resetTimings } = timings;
const { builtInExtensions } = extensionsModule;
const { validateThemeJson } = themeSchema;
const { setThemeJsonValidator } = themeModule;
const { cleanupWindowsSelfUpdateQuarantine } = windowsSelfUpdate;
const { isTruthyEnvFlag } = cliInput;
const { runAuthCommand } = runAuthCommandModule;
const { runSubcommand } = subcommands;

function bootstrap(args: string[], options: mainTypes.MainOptions | undefined) {
  return Effect.runPromise(
    awaiting(function* () {
      resetTimings();
      setThemeJsonValidator(validateThemeJson);
      const extensionFactories = [...builtInExtensions, ...(options?.extensionFactories ?? [])];
      const offlineMode = args.includes("--offline") || isTruthyEnvFlag(readEnv("MSA_OFFLINE"));
      if (offlineMode) {
        writeEnv("MSA_OFFLINE", "1");
        writeEnv("MSA_SKIP_VERSION_CHECK", "1");
      }
      if (yield* awaited(runAuthCommand(args))) return undefined;
      if (process.platform === "win32") {
        yield* awaited(cleanupWindowsSelfUpdateQuarantine(getPackageDir()));
      }
      const cwd = process.cwd();
      const agentDir = getAgentDir();
      const bootstrapSettingsManager = SettingsManager.create(cwd, agentDir, {
        projectTrusted: false,
      });
      applyHttpProxySettings(bootstrapSettingsManager.getGlobalSettings().httpProxy);
      configureHttpDispatcher();
      const handled = yield* awaited(runSubcommand(args, { agentDir, cwd, extensionFactories }));
      if (handled !== false) return undefined;
      return { agentDir, cwd, extensionFactories, offlineMode };
    }),
  );
}

const bootstrapModule = { bootstrap };

export default bootstrapModule;
