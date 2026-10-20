import type storeTypes from "../../../core/memory/store.types.ts";
import themeModule from "../theme/theme.ts";

const { theme } = themeModule;

const LIST_LIMIT = 200;

const SEARCH_LIMIT = 50;

const KIND_GLYPH: Record<storeTypes.MemoryKind, string> = {
  decision: "▲",
  fact: "●",
  note: "○",
  preference: "◆",
};

const KIND_COLOR: Record<storeTypes.MemoryKind, "accent" | "success" | "warning" | "muted"> = {
  decision: "warning",
  fact: "accent",
  note: "muted",
  preference: "success",
};

function glyph(record: storeTypes.MemoryRecord): string {
  return theme.fg(KIND_COLOR[record.kind], KIND_GLYPH[record.kind]);
}

function scopeLabel(record: storeTypes.MemoryRecord): string {
  return record.scope === "project" ? `project:${record.project ?? "?"}` : "global";
}

function firstLine(text: string): string {
  return text.split("\n")[0] ?? "";
}

const memoryViewHelpers = {
  KIND_COLOR,
  KIND_GLYPH,
  LIST_LIMIT,
  SEARCH_LIMIT,
  firstLine,
  glyph,
  scopeLabel,
};

export default memoryViewHelpers;
