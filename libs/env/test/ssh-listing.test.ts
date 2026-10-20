import { BACKGROUND_CONTEXT } from "@msa/chord/context";
import { getOrThrow } from "@msa/durable/env";
import { Effect } from "effect";
import { describe, expect, it } from "vite-plus/test";

import listFilesModule from "../src/list-files.ts";
import remoteEnv from "../src/remote-env.ts";
import listingTree from "./listing-tree.ts";
import sshdModule from "./sshd.ts";
import type sshdTypes from "./sshd.types.ts";

const { RemoteExecutionEnv } = remoteEnv;
const { LocalExecutionEnv } = listFilesModule;

const { expectedListing, makeTree } = listingTree;
const { connectTo, localConnection, sshd, useSshd } = sshdModule;

const context = BACKGROUND_CONTEXT;

const listsLikeLocal = (server: sshdTypes.SshServer): Effect.Effect<void> =>
  Effect.gen(function* () {
    yield* makeTree(server.home);
    const { connection } = yield* Effect.promise(() => connectTo({ server }));
    const local = localConnection();
    yield* Effect.gen(function* () {
      const remote = new RemoteExecutionEnv({ connection, cwd: server.home, id: "msa-env:test" });
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
