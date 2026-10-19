import { type Storage } from "@msa/durable";
import { MemoryStorage } from "@msa/durable/storage/memory";
import { Effect } from "effect";

import { openNodeJsonlStorage } from "../../src/storage/jsonl/node.ts";
import { openNodeSqliteStorage } from "../../src/storage/sqlite/node.ts";
import { awaited, context, currentTimeMillis, makeTempDir, tempPath } from "../support.ts";

export interface OpenedStorage {
  readonly storage: Storage;
  readonly location: string | undefined;
}

export const openJsonExampleStorage = Effect.fn("openJsonExampleStorage")(function* (
  kind: string | undefined,
) {
  if (kind === "sqlite") {
    const location = tempPath(`msa-durable-json-${currentTimeMillis()}.sqlite`);
    const opened: OpenedStorage = {
      storage: yield* awaited(openNodeSqliteStorage(location)),
      location,
    };
    return opened;
  }
  if (kind === "jsonl") {
    const location = yield* makeTempDir("msa-durable-json-");
    const opened: OpenedStorage = {
      storage: yield* awaited(openNodeJsonlStorage(location, context)),
      location,
    };
    return opened;
  }
  if (kind === "memory") {
    const opened: OpenedStorage = { storage: new MemoryStorage(), location: undefined };
    return opened;
  }
  throw new Error(`Unknown --storage ${kind}; use sqlite, jsonl, or memory`);
});
