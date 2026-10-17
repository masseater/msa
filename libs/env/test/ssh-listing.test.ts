import { BACKGROUND_CONTEXT } from "@msa/chord/context";
import { getOrThrow } from "@msa/durable/env";
import { Effect } from "effect";
import { describe, expect, it } from "vite-plus/test";

import { Connection } from "../src/connection.ts";
import { LocalExecutionEnv } from "../src/list-files.ts";
import { RemoteExecutionEnv } from "../src/remote-env.ts";
import { daemon } from "./daemon.ts";
import { expectedListing, makeTree } from "./listing-tree.ts";
import { connectTo, type SshServer, sshd, useSshd } from "./sshd.ts";

const context = BACKGROUND_CONTEXT;

const listsLikeLocal = (server: SshServer): Effect.Effect<void> =>
  Effect.gen(function* () {
    makeTree(server.home);
    const { connection } = yield* Effect.promise(() => connectTo({ server }));
    const local = new Connection({ command: [daemon] });
    yield* Effect.gen(function* () {
      const remote = new RemoteExecutionEnv({ connection, id: "msa-env:test", cwd: server.home });
      const listing = getOrThrow(
        yield* Effect.promise(() => remote.listFiles("tree", { exclude: ["skip"] }, context)),
      );
      expect(listing).toEqual(expectedListing);
      const env = new LocalExecutionEnv({ connection: local, cwd: server.home });
      const locally = yield* Effect.promise(() =>
        env.listFiles("tree", { exclude: ["skip"] }, context),
      );
      expect(getOrThrow(locally)).toEqual(listing);
    }).pipe(
      Effect.ensuring(
        Effect.sync(() => {
          connection.close();
          local.close();
        }),
      ),
    );
  });

describe.skipIf(sshd === undefined)("SSH listing", () => {
  const server = useSshd(true);
  it(
    "lists files over SSH as the local environment lists them",
    () => Effect.runPromise(listsLikeLocal(server())),
    60_000,
  );
});
