import { BACKGROUND_CONTEXT } from "@msa/chord/context";
import { Effect } from "effect";

import { Connection } from "../src/connection.ts";
import { RemoteExecutionEnv } from "../src/remote-env.ts";

const [daemon, cwd] = process.argv.slice(2);
if (daemon === undefined || cwd === undefined) throw new Error("usage: fixture <daemon> <cwd>");

const program = Effect.gen(function* () {
  let starts = 0;
  const connection = new Connection({
    command: () => {
      starts += 1;
      return starts === 1 ? Promise.resolve([daemon]) : Promise.reject(new Error("offline"));
    },
  });
  const env = new RemoteExecutionEnv({ connection, id: "msa-env:watch-exit", cwd });
  const watched = yield* Effect.promise(() =>
    env.watch([{ path: "." }], () => {}, BACKGROUND_CONTEXT),
  );
  if (!watched.ok) return yield* Effect.die(watched.error);
  const info = yield* Effect.promise(() => connection.info());
  process.kill(info.pid, "SIGKILL");
  yield* Effect.sleep(500);
  yield* Effect.sync(() => {
    process.stdout.write("ready\n");
  });
});

await Effect.runPromise(program);
