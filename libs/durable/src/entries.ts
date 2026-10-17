import type { JsonValue } from "@msa/chord";

import type { CompactionReason, ToolDiagnostic } from "./harness/types.ts";
import type { Entry, EntryRecord, TypedEntry } from "./types.ts";

export function defineEntry<D extends JsonValue = never>(kind: string): Entry<D> {
  if (typeof kind !== "string" || kind.length === 0)
    throw new TypeError("Entry kind must be a non-empty string");
  return {
    kind,
    is: (entry: EntryRecord | undefined): entry is TypedEntry<D> =>
      entry !== undefined && entry.kind === kind,
  };
}

export const UserEntry = defineEntry("msa.user");
export const AssistantEntry = defineEntry("msa.assistant");
export const SystemEntry = defineEntry("msa.system");
export const ToolResultEntry = defineEntry<{ diagnostics: ToolDiagnostic[] }>("msa.tool-result");
export const ResetEntry = defineEntry("msa.reset");
export const CompactionEntry = defineEntry<{ reason: CompactionReason }>("msa.compaction");
