import { Effect, Option } from "effect";
import { describe, expect, it } from "vite-plus/test";

import daemon from "./daemon.ts";
import platform from "./platform.ts";

const { localPath, makeTempDirectory, removePath, runText } = platform;

const fixture = localPath.join(import.meta.dirname, "watch-exit-fixture.ts");

const exitsWhileWaiting = Effect.gen(function* () {
  const cwd = yield* makeTempDirectory("msa-env-watch-exit-");
  yield* Effect.ensuring(
    Effect.gen(function* () {
      const stdout = yield* runText([
        process.execPath,
        "--conditions=source",
        fixture,
        daemon,
        cwd,
      ]).pipe(Effect.timeoutOption(20_000));
      expect(Option.isSome(stdout)).toBe(true);
      if (Option.isSome(stdout)) expect(stdout.value).toContain("ready");
    }),
    removePath(cwd),
  );
});

describe("RemoteWatcher", () => {
  it(
    "lets the process exit while it waits to reconnect",
    () => Effect.runPromise(exitsWhileWaiting),
    30_000,
  );
});
