import sessionFormat from "../session-manager/session-format.ts";
import entryPartsModule from "./entry-parts.ts";
import indexer from "./indexer.ts";
import type sessionSearchTypes from "./session-search.types.ts";

const { parseSessionEntryLine } = sessionFormat;
const { entryParts, isRecord } = entryPartsModule;

type ReadEntry = sessionSearchTypes.ReadEntry;

const EMPTY: ReadEntry = { at: null, entryId: null, parts: [] };

function readEntry(path: string, offset: number, length: number): Promise<ReadEntry> {
  return indexer.readSlice(path, offset, offset + length).then(
    (bytes) => {
      const entry = parseSessionEntryLine(new TextDecoder().decode(bytes));
      if (!isRecord(entry)) return EMPTY;
      return {
        at: indexer.timeOf(entry["timestamp"]),
        entryId: typeof entry["id"] === "string" ? entry["id"] : null,
        parts: entryParts(entry),
      };
    },
    () => EMPTY,
  );
}

const entryRead = { readEntry };

export default entryRead;
