import { Effect } from "effect";

import config from "../config.ts";
import awaitingModule from "../core/awaiting.ts";
import extensionsModule from "../extensions/index.ts";
import type mainTypes from "../main.types.ts";
import environment from "./environment.ts";
import hostSetup from "./host-setup.ts";
import runAuthCommandModule from "./run-auth-command.ts";
import subcommands from "./subcommands.ts";

const { awaited, awaiting } = awaitingModule;
const { getAgentDir } = config;
const { builtInExtensions } = extensionsModule;
const { prepareEnvironment } = environment;
const { prepareHost } = hostSetup;
const { runAuthCommand } = runAuthCommandModule;
const { runSubcommand } = subcommands;

function bootstrap(args: string[], options: mainTypes.MainOptions | undefined) {
  return Effect.runPromise(
    awaiting(function* () {
      const offlineMode = prepareEnvironment(args);
      const extensionFactories = [...builtInExtensions, ...(options?.extensionFactories ?? [])];
      if (yield* awaited(runAuthCommand(args))) return undefined;
      const cwd = process.cwd();
      const agentDir = getAgentDir();
      yield* awaited(prepareHost(cwd, agentDir));
      const handled = yield* awaited(runSubcommand(args, { agentDir, cwd, extensionFactories }));
      if (handled !== false) return undefined;
      return { agentDir, cwd, extensionFactories, offlineMode };
    }),
  );
}

const bootstrapModule = { bootstrap };

export default bootstrapModule;
