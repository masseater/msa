import toolNames from "../orchestrator/tool-names.ts";
import platform from "../platform/index.ts";
import sessionFormat from "../session-manager/session-format.ts";
import entryPartsModule from "./entry-parts.ts";
import type sessionSearchTypes from "./session-search.types.ts";
import terms from "./terms.ts";

const { isAbsolute, relative, toEpochMs } = platform;
const { parseSessionEntryLine } = sessionFormat;
const { entryParts, isRecord } = entryPartsModule;
const { isOrchestratorTool } = toolNames;

const NEWLINE = 10;

type FoundFile = sessionSearchTypes.FoundFile;

const under = (path: string, roots: readonly string[]): boolean =>
  roots.some((root) => {
    const inside = relative(root, path);
    return inside !== "" && !inside.startsWith("..") && !isAbsolute(inside);
  });

const sameBytes = (left: Uint8Array, right: Uint8Array): boolean =>
  left.length === right.length && left.every((byte, index) => byte === right[index]);

const timeOf = (value: unknown): number | null => {
  if (typeof value !== "string") return null;
  const time = toEpochMs(value);
  return Number.isNaN(time) ? null : time;
};

interface LineScan {
  parts: sessionSearchTypes.PartRow[];
  header: sessionSearchTypes.SessionHeader | undefined;
  orchestrator: boolean;
}

function headerOf(entry: Record<string, unknown>): sessionSearchTypes.SessionHeader | undefined {
  if (entry["type"] !== "session" || typeof entry["id"] !== "string") return undefined;
  return {
    cwd: typeof entry["cwd"] === "string" ? entry["cwd"] : "",
    sessionId: entry["id"],
    startedAt: timeOf(entry["timestamp"]),
  };
}

function scanLine(scan: LineScan, line: string, offset: number, length: number): void {
  const entry = parseSessionEntryLine(line);
  if (!isRecord(entry)) return;
  scan.header ??= headerOf(entry);
  const entryId = typeof entry["id"] === "string" ? entry["id"] : null;
  const at = timeOf(entry["timestamp"]);
  entryParts(entry).forEach((part, index) => {
    if (part.kind === "tool_call" && part.tool !== null && isOrchestratorTool(part.tool)) {
      scan.orchestrator = true;
    }
    if (part.text.trim() === "") return;
    scan.parts.push({
      at,
      body: terms.indexText(part.text),
      entryId,
      kind: part.kind,
      length,
      offset,
      part: index,
      tool: part.tool,
    });
  });
}

function scanLines(bytes: Uint8Array, base: number): LineScan & { end: number } {
  const decoder = new TextDecoder();
  const scan: LineScan = { header: undefined, orchestrator: false, parts: [] };
  let start = 0;
  let newline = bytes.indexOf(NEWLINE, start);
  while (newline !== -1) {
    const line = decoder.decode(bytes.subarray(start, newline));
    scanLine(scan, line, base + start, newline - start);
    start = newline + 1;
    newline = bytes.indexOf(NEWLINE, start);
  }
  return { ...scan, end: base + start };
}

const reasonOf = (defect: unknown): string =>
  defect instanceof Error ? `${defect.name}: ${defect.message}` : String(defect);

const skippedUpdate = (
  file: FoundFile,
  basis: sessionSearchTypes.FileRow | undefined,
  defect: unknown,
): sessionSearchTypes.FileUpdate => ({
  basis,
  failure: reasonOf(defect),
  from: 0,
  header: undefined,
  indexed: 0,
  mtime: file.mtime,
  orchestrator: false,
  parts: [],
  path: file.path,
  size: file.size,
  tail: new Uint8Array(0),
});

const BATCH_BYTES = 8 << 20;

const bodyBytes = (update: sessionSearchTypes.FileUpdate): number =>
  update.parts.reduce((total, part) => total + part.body.length, 0);

const changedSince = (file: FoundFile, row: sessionSearchTypes.FileRow | undefined): boolean =>
  row === undefined || row.size !== file.size || row.mtime !== file.mtime;

const lineScan = {
  BATCH_BYTES,
  bodyBytes,
  changedSince,
  sameBytes,
  scanLines,
  skippedUpdate,
  timeOf,
  under,
};

export default lineScan;
