import { Effect } from "effect";
import { dual } from "effect/Function";

import awaitingModule from "./core/awaiting.ts";
import type mainTypes from "./main.types.ts";
import bootstrapModule from "./main/bootstrap.ts";
import runModes from "./main/run-modes.ts";
import runSession from "./main/run-session.ts";
import sessionSetup from "./main/session-setup.ts";
import startupChecks from "./main/startup-checks.ts";
import startupModule from "./main/startup.ts";

const { awaited, awaiting } = awaitingModule;
const { bootstrap } = bootstrapModule;
const { runMode } = runModes;
const { exitForMetadataCommands, prepareInput, startRuntime } = runSession;
const { createSessionManager } = sessionSetup;
const { checkStartup } = startupChecks;
const { prepareStartup } = startupModule;

function mainImpl(args: string[], options?: mainTypes.MainOptions): Promise<undefined> {
  return Effect.runPromise(
    awaiting(function* () {
      const boot = yield* awaited(bootstrap(args, options));
      if (boot === undefined) return undefined;
      const startup = yield* awaited(prepareStartup(args, boot));
      const runtime = yield* awaited(startRuntime(startup));
      yield* awaited(exitForMetadataCommands(startup, runtime));
      const input = yield* awaited(prepareInput(startup, runtime));
      const checks = checkStartup(startup, runtime);
      yield* awaited(runMode(startup, runtime, input, checks));
      return undefined;
    }),
  );
}

const main: {
  (args: string[], options?: mainTypes.MainOptions): Promise<undefined>;
  (options?: mainTypes.MainOptions): (args: string[]) => Promise<undefined>;
} = dual((args: IArguments) => args.length >= 1, mainImpl);

const mainModule = { createSessionManager, main };

export default mainModule;
