import { MemoryStorage } from "@msa/durable/storage/memory";
import { Effect } from "effect";

import { openNodeJsonlStorage } from "../../src/storage/jsonl/node.ts";
import { openNodeSqliteStorage } from "../../src/storage/sqlite/node.ts";
import support from "../support.ts";
import type jsonStorageTypes from "./json-storage.types.ts";

const { awaited, context, currentTimeMillis, makeTempDir, tempPath } = support;

const openJsonExampleStorage = Effect.fn("openJsonExampleStorage")(function* (
  kind: string | undefined,
) {
  if (kind === "sqlite") {
    const location = tempPath(`msa-durable-json-${currentTimeMillis()}.sqlite`);
    const opened: jsonStorageTypes.OpenedStorage = {
      location,
      storage: yield* awaited(openNodeSqliteStorage(location)),
    };
    return opened;
  }
  if (kind === "jsonl") {
    const location = yield* makeTempDir("msa-durable-json-");
    const opened: jsonStorageTypes.OpenedStorage = {
      location,
      storage: yield* awaited(openNodeJsonlStorage(location, context)),
    };
    return opened;
  }
  if (kind === "memory") {
    const opened: jsonStorageTypes.OpenedStorage = {
      location: undefined,
      storage: new MemoryStorage(),
    };
    return opened;
  }
  throw new Error(`Unknown --storage ${kind}; use sqlite, jsonl, or memory`);
});

export default openJsonExampleStorage;
