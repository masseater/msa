import { fileURLToPath } from "node:url";

import {
  awaited,
  dirnameOf,
  joinPath,
  makeTempDir,
  readDirectory,
  readTextFile,
  removePath,
} from "@msa/testing";
import { Effect } from "effect";

import { RpcClient } from "../src/modes/rpc/rpc-client.ts";

const sourceDir = dirnameOf(fileURLToPath(import.meta.url));

export const readSessionEntries = (sessionDir: string): Effect.Effect<any[]> =>
  Effect.gen(function* () {
    const sessionsPath = joinPath(sessionDir, "sessions");
    const sessionDirs = yield* readDirectory(sessionsPath);
    const [sessionDirName] = sessionDirs;
    if (sessionDirName === undefined) throw new Error("expected a session directory");
    const cwdSessionDir = joinPath(sessionsPath, sessionDirName);
    const sessionFiles = (yield* readDirectory(cwdSessionDir)).filter((file) =>
      file.endsWith(".jsonl"),
    );
    const [sessionFileName] = sessionFiles;
    if (sessionFileName === undefined) throw new Error("expected a session file");
    const sessionContent = yield* readTextFile(joinPath(cwdSessionDir, sessionFileName));
    return sessionContent
      .trim()
      .split("\n")
      .map((line) => JSON.parse(line));
  });

export const withClient = <A, E>(
  use: (client: RpcClient, sessionDir: string) => Effect.Effect<A, E>,
): Effect.Effect<A, E> =>
  Effect.gen(function* () {
    const sessionDir = yield* makeTempDir("msa-rpc-test-");
    const client = new RpcClient({
      cliPath: joinPath(sourceDir, "..", "dist", "cli.js"),
      cwd: joinPath(sourceDir, ".."),
      env: { MSA_CODING_AGENT_DIR: sessionDir },
      provider: "anthropic-api",
      model: "claude-sonnet-4-5",
    });
    try {
      yield* awaited(client.start());
      return yield* use(client, sessionDir);
    } finally {
      yield* Effect.ignore(awaited(client.stop()));
      yield* removePath(sessionDir);
    }
  });
