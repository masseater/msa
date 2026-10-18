import * as NodeServices from "@effect/platform-node/NodeServices";
import { joinPath, toJsonText } from "@msa/testing";
import { Effect, FileSystem, ManagedRuntime } from "effect";
import { afterEach, beforeEach, describe, expect, it, vi } from "vite-plus/test";

import { ENV_AGENT_DIR } from "../../../src/config.ts";
import { SessionManager } from "../../../src/core/session-manager.ts";

const runtime = ManagedRuntime.make(NodeServices.layer);
const fs = runtime.runSync(FileSystem.FileSystem.useSync((service) => service));

let tempDir: string;

let sessionsDir: string;

function writeSession(dir: string, id: string) {
  return runtime.runPromise(
    Effect.gen(function* () {
      yield* fs.makeDirectory(dir, { recursive: true });
      yield* fs.writeFileString(
        joinPath(dir, `${id}.jsonl`),
        `${yield* toJsonText({
          type: "session",
          version: 3,
          id,
          timestamp: "2026-08-03T00:00:00.000Z",
          cwd: joinPath(tempDir, "project"),
        })}\n`,
      );
    }),
  );
}

const discoversASessionThroughADirectory = Effect.gen(function* () {
  const targetDir = joinPath(tempDir, "linked-sessions");
  yield* Effect.promise(() => writeSession(targetDir, "linked"));
  const aliasDir = joinPath(sessionsDir, "--linked--");
  yield* fs.symlink(targetDir, aliasDir);

  const sessions = yield* Effect.promise(() => SessionManager.listAll());

  expect(sessions.map((session) => session.id)).toEqual(["linked"]);
  expect(sessions[0]?.path).toBe(joinPath(aliasDir, "linked.jsonl"));
});

const ignoresABrokenDirectoryLinkWithout = Effect.gen(function* () {
  yield* Effect.promise(() => writeSession(joinPath(sessionsDir, "--regular--"), "regular"));
  const targetDir = joinPath(tempDir, "removed-sessions");
  yield* fs.makeDirectory(targetDir);
  yield* fs.symlink(targetDir, joinPath(sessionsDir, "--broken--"));
  yield* fs.remove(targetDir, { recursive: true });

  const sessions = yield* Effect.promise(() => SessionManager.listAll());

  expect(sessions.map((session) => session.id)).toEqual(["regular"]);
});

const ignoresLinksToFiles = Effect.gen(function* () {
  yield* Effect.promise(() => writeSession(joinPath(sessionsDir, "--regular--"), "regular"));
  const targetFile = joinPath(tempDir, "not-a-directory");
  yield* fs.writeFileString(targetFile, "");
  yield* fs.symlink(targetFile, joinPath(sessionsDir, "--file--"));

  const sessions = yield* Effect.promise(() => SessionManager.listAll());

  expect(sessions.map((session) => session.id)).toEqual(["regular"]);
});

describe("regression #7497: discover sessions through symlinked directories", () => {
  beforeEach(() =>
    runtime.runPromise(
      Effect.gen(function* () {
        tempDir = yield* fs.makeTempDirectory({ prefix: "msa-session-discovery-" });
        const agentDir = joinPath(tempDir, "agent");
        sessionsDir = joinPath(agentDir, "sessions");
        yield* fs.makeDirectory(sessionsDir, { recursive: true });
        vi.stubEnv(ENV_AGENT_DIR, agentDir);
      }),
    ),
  );
  afterEach(() =>
    runtime.runPromise(
      Effect.gen(function* () {
        vi.unstubAllEnvs();
        yield* fs.remove(tempDir, { recursive: true, force: true });
      }),
    ),
  );
  it("discovers a session through a directory link and preserves the alias path", () =>
    Effect.runPromise(discoversASessionThroughADirectory));
  it("ignores a broken directory link without hiding valid sessions", () =>
    Effect.runPromise(ignoresABrokenDirectoryLinkWithout));
  it.skipIf(process.platform === "win32")("ignores links to files", () =>
    Effect.runPromise(ignoresLinksToFiles),
  );
});
