import { Effect } from "effect";
import { dual } from "effect/Function";

import awaitingModule from "./core/awaiting.ts";
import type mainTypes from "./main.types.ts";
import bootstrapModule from "./main/bootstrap.ts";
import runModes from "./main/run-modes.ts";
import runtimeStart from "./main/runtime-start.ts";
import sessionInput from "./main/session-input.ts";
import startupChecks from "./main/startup-checks.ts";
import startupModule from "./main/startup.ts";

const { awaited, awaiting } = awaitingModule;
const { bootstrap } = bootstrapModule;
const { runMode } = runModes;
const { startRuntime } = runtimeStart;
const { exitForMetadataCommands, prepareInput } = sessionInput;
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

const mainModule = { main };

export default mainModule;
