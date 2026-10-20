import { BACKGROUND_CONTEXT } from "@msa/chord/context";
import { getOrThrow } from "@msa/durable/env";
import { Effect } from "effect";
import { afterAll, describe, expect, it } from "vite-plus/test";

import { Connection } from "../src/connection.ts";
import { RemoteExecutionEnv } from "../src/remote-env.ts";
import { nodePlatform } from "../src/remote-info.ts";
import daemon from "./daemon.ts";
import platformModule from "./platform.ts";
import remoteEnvironments from "./remote-environment.ts";

const { localPath } = platformModule;

const context = BACKGROUND_CONTEXT;
const environments = remoteEnvironments();
afterAll(environments.close);
const { environment } = environments;

const run = (effect: Effect.Effect<void>): Promise<void> => Effect.runPromise(effect);

const nodeNames = Effect.gen(function* () {
  const { connection } = yield* environment;
  const { platform, arch } = nodePlatform(yield* Effect.promise(() => connection.info()));
  expect(platform).toBe(process.platform);
  const rosetta = process.platform === "darwin" && process.arch === "arm64" && arch === "x64";
  if (!rosetta) expect(arch).toBe(process.arch);
  expect(nodePlatform({ arch: "aarch64", os: "windows" })).toEqual({
    arch: "arm64",
    platform: "win32",
  });
  expect(nodePlatform({ arch: "x86_64", os: "macos" })).toEqual({
    arch: "x64",
    platform: "darwin",
  });
});

const oldDaemonListing = Effect.gen(function* () {
  const { env } = yield* environment;
  expect((yield* Effect.promise(() => env.connection.info())).features).toContain("listFiles");
  const connection = new Connection({
    command: [process.execPath, localPath.join(import.meta.dirname, "old-daemon.ts")],
  });
  environments.track(connection);
  const old = new RemoteExecutionEnv({ connection, cwd: env.cwd, id: "msa-env:old" });
  const listed = yield* Effect.promise(() => old.listFiles(".", undefined, context));
  expect(listed.ok ? "ok" : listed.error.code).toBe("not_supported");
});

const lostHandles = Effect.gen(function* () {
  const { env, connection } = yield* environment;
  getOrThrow(yield* Effect.promise(() => env.writeFile("a.txt", "AAA", context)));
  getOrThrow(yield* Effect.promise(() => env.writeFile("b.txt", "BBB", context)));
  const a = getOrThrow(
    yield* Effect.promise(() => env.openBinaryReader("a.txt", undefined, context)),
  );
  const { pid } = yield* Effect.promise(() => connection.info());
  process.kill(pid, "SIGKILL");
  yield* Effect.sleep(300);
  const b = getOrThrow(
    yield* Effect.promise(() => env.openBinaryReader("b.txt", undefined, context)),
  );
  expect((yield* Effect.promise(() => connection.info())).pid).not.toBe(pid);
  const stale = yield* Effect.promise(() => a.read(0, 3, context));
  expect(stale.ok ? new TextDecoder().decode(stale.value) : stale.error.code).toBe("unknown");
  const fresh = getOrThrow(yield* Effect.promise(() => b.read(0, 3, context)));
  expect(new TextDecoder().decode(fresh)).toBe("BBB");
  yield* Effect.promise(() => a.close(context));
  yield* Effect.promise(() => b.close(context));
});

const retriedStart = Effect.gen(function* () {
  const cwd = yield* environments.tempDir;
  let starts = 0;
  const connection = new Connection({
    command: () => {
      starts++;
      if (starts === 1) {
        return Promise.reject(new Error("ssh gpu-box failed: Network is unreachable"));
      }
      return Promise.resolve([daemon]);
    },
  });
  environments.track(connection);
  const env = new RemoteExecutionEnv({ connection, cwd, id: "msa-env:test" });
  const offline = yield* Effect.promise(() => env.readTextFile("missing.txt", context));
  expect(offline.ok ? "ok" : [offline.error.code, offline.error.message]).toEqual([
    "unknown",
    "ssh gpu-box failed: Network is unreachable",
  ]);
  const command = yield* Effect.promise(() => env.exec(["sh", "-c", "exit 0"], undefined, context));
  expect(command.ok ? command.value.exitCode : command.error.code).toBe(0);
  expect(starts).toBe(2);
});

describe("RemoteExecutionEnv", () => {
  it("reports the remote system in Node's names", () => run(nodeNames));
  it("reports listFiles as not supported by daemons released before it", () =>
    run(oldDaemonListing));
  it("fails requests on handles of a lost connection instead of reaching the new daemon", () =>
    run(lostHandles));
  it("computes the command at each start and retries a start that failed", () => run(retriedStart));
});
