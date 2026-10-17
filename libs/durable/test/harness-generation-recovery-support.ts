import { mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { openNodeSqliteStorage } from "../src/storage/sqlite/node.ts";
import { type ChatSetup, openChat } from "./chat-support.ts";

export const directories = new Set<string>();

export async function sqlitePath(): Promise<string> {
  const directory = await mkdtemp(join(tmpdir(), "msa-durable-generation-"));
  directories.add(directory);
  return join(directory, "session.sqlite");
}

export async function open(path: string, setup: ChatSetup) {
  return openChat(await openNodeSqliteStorage(path), setup);
}
