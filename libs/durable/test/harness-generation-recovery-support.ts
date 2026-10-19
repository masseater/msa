import { Effect } from "effect";

import { openNodeSqliteStorage } from "../src/storage/sqlite/node.ts";
import { type ChatSetup, openChat } from "./chat-support.ts";
import { awaited } from "./effect-support.ts";
import { joinPath, makeTempDir } from "./platform-support.ts";

export const directories = new Set<string>();

export const sqlitePath = Effect.fn("sqlitePath")(function* () {
  const directory = yield* makeTempDir("msa-durable-generation-");
  directories.add(directory);
  return joinPath(directory, "session.sqlite");
});

export const open = Effect.fn("open")(function* (path: string, setup: ChatSetup) {
  return yield* openChat(yield* awaited(openNodeSqliteStorage(path)), setup);
});
