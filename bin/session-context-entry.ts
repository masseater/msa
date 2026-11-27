import { Predicate, Schema } from "effect";

import sessionContextEntrySchema from "./session-context-entry-schema.ts";
import type sessionContextEntryTypes from "./session-context-entry.types.ts";
import toolCalls from "./tool-calls.ts";
import type toolCallsTypes from "./tool-calls.types.ts";

const { toolCallsOf } = toolCalls;
const { ContextEntrySchema, UsageRecord } = sessionContextEntrySchema;

const decodeEntry = Schema.decodeUnknownEffect(Schema.fromJsonString(ContextEntrySchema));

const decodeContextEntry = (line: string) => decodeEntry(line);

const COMPONENT_TOKEN_KEYS = ["input", "output", "cacheRead", "cacheWrite"] as const;

const usageNumber = (usage: sessionContextEntryTypes.ContextUsage, key: string): number =>
  Number(usage[key] ?? 0);

const positiveFinite = (value: number): number | null =>
  Number.isFinite(value) && value > 0 ? value : null;

const componentTokens = (usage: sessionContextEntryTypes.ContextUsage): number =>
  COMPONENT_TOKEN_KEYS.reduce((sum, key) => sum + usageNumber(usage, key), 0);

const contextTokens = (usage: sessionContextEntryTypes.ContextUsage | undefined): number | null =>
  usage === undefined
    ? null
    : (positiveFinite(usageNumber(usage, "totalTokens")) ?? positiveFinite(componentTokens(usage)));

const bashCommandOf = (block: toolCallsTypes.Block): ReadonlyArray<string> => {
  const args = block["arguments"];
  const command = Predicate.hasProperty("command")(args) ? args.command : undefined;
  return Predicate.isString(command) && command !== "" ? [command] : [];
};

const bashCommandsOf = (message: sessionContextEntryTypes.ContextMessage): ReadonlyArray<string> =>
  toolCallsOf({ message, name: "bash" }).flatMap(bashCommandOf);

const providerModelOf = (message: sessionContextEntryTypes.ContextMessage): string =>
  `${message.provider ?? "[unknown]"}/${message.model ?? "[unknown]"}`;

const sessionContextEntry = {
  ContextEntrySchema,
  UsageRecord,
  bashCommandsOf,
  contextTokens,
  decodeContextEntry,
  providerModelOf,
};

export default sessionContextEntry;
