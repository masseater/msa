import { Effect } from "effect";

import { openNodeSqliteStorage } from "../src/storage/sqlite/node.ts";
import chatSupport from "./chat-support.ts";
import type chatSupportTypes from "./chat-support.types.ts";
import effectSupport from "./effect-support.ts";
import platformSupport from "./platform-support.ts";

const { openChat } = chatSupport;
const { awaited } = effectSupport;
const { joinPath, makeTempDir } = platformSupport;

const directories = new Set<string>();

const sqlitePath = Effect.fn("sqlitePath")(function* () {
  const directory = yield* makeTempDir("msa-durable-generation-");
  directories.add(directory);
  return joinPath(directory, "session.sqlite");
});

const open = Effect.fn("open")(function* (path: string, setup: chatSupportTypes.ChatSetup) {
  return yield* openChat(yield* awaited(openNodeSqliteStorage(path)), setup);
});

const harnessGenerationRecoverySupport = {
  directories,
  open,
  sqlitePath,
};

export default harnessGenerationRecoverySupport;
