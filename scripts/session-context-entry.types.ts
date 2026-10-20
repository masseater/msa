import type sessionContextEntrySchema from "./session-context-entry-schema.ts";

declare namespace sessionContextEntryTypes {
  type ContextEntry = typeof sessionContextEntrySchema.ContextEntrySchema.Type;

  type ContextMessage = NonNullable<ContextEntry["message"]>;

  type ContextUsage = typeof sessionContextEntrySchema.UsageRecord.Type;
}

export type { sessionContextEntryTypes as default };
