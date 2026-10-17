import { AgentDoc } from "./agent.ts";
import { InboxDoc } from "./inbox.ts";
import { LiveDoc } from "./live.ts";
import { ProviderDoc } from "./provider.ts";
import type { ConversationDocToken, DocumentId, EntryRecord, JsonObject } from "./types.ts";
import { UsageDoc } from "./usage.ts";
import type { ConversationView, ViewObserver } from "./view-types.ts";

export const MOUNTED = [
  AgentDoc,
  LiveDoc,
  InboxDoc,
  ProviderDoc,
  UsageDoc,
] as unknown as readonly ConversationDocToken<JsonObject>[];

export const MOUNTED_KINDS: ReadonlySet<string> = new Set(
  MOUNTED.map((token) => token.definition.kind),
);

export type Mount = {
  value: ConversationView;
  readonly docs: Map<string, { id: DocumentId; version: number }>;
  readonly observers: Set<ViewObserver>;
};

export type MountedEntries = readonly EntryRecord[];
