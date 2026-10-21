import testing from "@msa/testing";
import { Effect } from "effect";
import { afterEach, describe, expect, test } from "vite-plus/test";

import RpcClient from "../src/modes/rpc/rpc-client.ts";
const { awaited, joinPath, makeTempDir, removeDirs, runTest, writeTextFile } = testing;

const tempDirs: string[] = [];

const writeChildScript = Effect.fn("writeChildScript")(function* (contents: string) {
  const dir = yield* makeTempDir("msa-rpc-client-exit-");
  tempDirs.push(dir);
  const path = joinPath(dir, "child.mjs");
  yield* writeTextFile(path, contents);
  return path;
});

afterEach(() => runTest(removeDirs(tempDirs.splice(0))));

const rejectsAnInFlightRequestWhenThe = () =>
  runTest(
    Effect.gen(function* () {
      const client = new RpcClient({
        cliPath: yield* writeChildScript(`
process.stdin.once("data", () => {
	process.exit(43);
});
process.stdin.resume();
`),
      });

      yield* awaited(client.start());

      yield* awaited(
        expect(client.getCommands()).rejects.toThrow(
          /Agent process exited \(code=43 signal=null\)/u,
        ),
      );
    }),
  );

describe("RpcClient child process failures", () => {
  test(
    "rejects an in-flight request when the child process exits",
    rejectsAnInFlightRequestWhenThe,
  );
});
