import platform from "../platform/index.ts";
import type DatabaseSync from "../platform/node/sqlite.ts";
import type sessionSearchTypes from "./session-search.types.ts";

const { formatLocalDateTime } = platform;

type EntryRow = sessionSearchTypes.EntryRow;
type EntryBlock = sessionSearchTypes.EntryBlock;
type Page = sessionSearchTypes.Page;

function entryWindow(
  database: DatabaseSync,
  request: { path: string; entry: string; before: number; after: number },
): EntryRow[] | undefined {
  const entries = database
    .prepare(
      `SELECT DISTINCT p.offset, p.length, p.entry_id FROM parts p
       JOIN files f ON f.id = p.file_id WHERE f.path = ? ORDER BY p.offset`,
    )
    .all(request.path) as unknown as EntryRow[];
  const index = entries.findIndex((row) => row.entry_id === request.entry);
  if (index === -1) return undefined;
  return entries.slice(Math.max(0, index - request.before), index + request.after + 1);
}

function blockText(
  entryId: string | null,
  at: number | null,
  parts: readonly sessionSearchTypes.Part[],
): string {
  const time = at === null ? "" : ` ${formatLocalDateTime(at)}`;
  return parts
    .map((part) => {
      const tool = part.tool === null ? "" : ` ${part.tool}`;
      return `--- ${part.kind}${tool}${time} entry ${entryId ?? "?"}\n${part.text}`;
    })
    .join("\n");
}

function render(blocks: readonly EntryBlock[], from: number, budget: number): Page {
  const lines: string[] = [];
  let remaining = budget;
  for (const [index, block] of blocks.entries()) {
    const skip = index === 0 ? Math.min(from, block.text.length) : 0;
    const body = block.text.slice(skip);
    if (body.length > remaining) {
      lines.push(body.slice(0, remaining));
      const next =
        block.entryId === null ? undefined : { entry: block.entryId, from: skip + remaining };
      return { next, text: lines.join("\n") };
    }
    lines.push(body);
    remaining -= body.length;
  }
  return { next: undefined, text: lines.join("\n") };
}

const reading = { blockText, entryWindow, render };

export default reading;
