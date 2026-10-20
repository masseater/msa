import type compatTypes from "@msa/ai/compat.types";
import tuiModule from "@msa/tui";
import type tuiTypes from "@msa/tui/index.types";
import { Effect } from "effect";

import type sessionManagerTypes from "../../core/session-manager.types.ts";
import type interactiveModeInternalTypes from "./interactive-mode-internal.types.ts";

const { fuzzyFilter } = tuiModule;

function isEmbeddedStatus(
  editor: tuiTypes.EditorComponent,
): editor is interactiveModeInternalTypes.WorkingStatusEditor {
  return (
    "embedWorkingStatus" in editor &&
    editor.embedWorkingStatus === true &&
    "setWorkingStatusIndicator" in editor &&
    typeof editor.setWorkingStatusIndicator === "function"
  );
}

function isCustomSessionEntry(
  item: interactiveModeInternalTypes.RenderSessionItem,
): item is Extract<sessionManagerTypes.SessionEntry, { type: "custom" }> {
  return "type" in item && item.type === "custom";
}

function isCompactionCostNotice(
  item: interactiveModeInternalTypes.RenderSessionItem,
): item is interactiveModeInternalTypes.CompactionCostNotice {
  return "type" in item && item.type === "compaction_cost";
}

function isUsageSessionEntry(
  item: interactiveModeInternalTypes.RenderSessionItem,
): item is Extract<sessionManagerTypes.SessionEntry, { type: "usage" }> {
  return "type" in item && item.type === "usage";
}

const DEAD_TERMINAL_ERROR_CODES = new Set(["EIO", "EPIPE", "ENOTCONN", "ENOTTY"]);

function isDeadTerminalError(error: unknown): boolean {
  if (typeof error !== "object" || error === null || !("code" in error)) {
    return false;
  }
  const code = (error as NodeJS.ErrnoException).code;
  return code !== undefined && DEAD_TERMINAL_ERROR_CODES.has(code);
}

function createFuzzyAutocompleteItems<T>(
  items: T[],
  prefix: string,
  getSearchText: (item: T) => string,
  toAutocompleteItem: (item: T) => tuiTypes.AutocompleteItem,
): tuiTypes.AutocompleteItem[] | null {
  const filtered = fuzzyFilter(items, prefix, getSearchText);
  if (filtered.length === 0) return null;
  return filtered.map(toAutocompleteItem);
}

function countDroppedThinkingBlocks(message: compatTypes.AssistantMessage): number {
  let count = 0;
  for (const diagnostic of message.diagnostics ?? []) {
    if (diagnostic.type !== "anthropic_input_transformations") continue;
    const transformations = diagnostic.details?.["transformations"];
    if (!Array.isArray(transformations)) continue;
    count += transformations.filter(
      (transformation) =>
        typeof transformation === "object" &&
        transformation !== null &&
        (transformation as Record<string, unknown>)["type"] === "thinking_dropped",
    ).length;
  }
  return count;
}

const syncCommand = (run: () => void) => () => Effect.sync(run);

const promiseCommand = (run: () => PromiseLike<unknown>) => () =>
  Effect.promise(() => Promise.resolve(run()));

const interactiveModeHelpers = {
  DEAD_TERMINAL_ERROR_CODES,
  countDroppedThinkingBlocks,
  createFuzzyAutocompleteItems,
  isCompactionCostNotice,
  isCustomSessionEntry,
  isDeadTerminalError,
  isEmbeddedStatus,
  isUsageSessionEntry,
  promiseCommand,
  syncCommand,
};

export default interactiveModeHelpers;
