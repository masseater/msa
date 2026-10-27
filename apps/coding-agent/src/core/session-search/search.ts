import type DatabaseSync from "../platform/node/sqlite.ts";
import type sessionSearchTypes from "./session-search.types.ts";
import terms from "./terms.ts";
import threadLinksModule from "./thread-links.ts";

const { sessionRole } = threadLinksModule;

type Filters = sessionSearchTypes.Filters;
type ThreadLink = sessionSearchTypes.ThreadLink;

const OWN_TOOL = "search_sessions";

type Order = sessionSearchTypes.Order;
type Located = sessionSearchTypes.Located;

interface HitRow {
  path: string;
  session_id: string | null;
  cwd: string | null;
  started_at: number | null;
  orchestrator: number;
  offset: number;
  length: number;
  part: number;
  kind: sessionSearchTypes.PartKind;
  tool: string | null;
  entry_id: string | null;
  at: number | null;
}

interface FileInfoRow {
  path: string;
  orchestrator: number;
}

const ORDER_SQL: Record<Order, string> = {
  newest: "p.at DESC, p.id DESC",
  oldest: "p.at ASC, p.id ASC",
  relevance: "rank",
};

const overlaps = (wanted: readonly string[] | undefined, actual: readonly string[]): boolean =>
  wanted === undefined || wanted.some((value) => actual.includes(value));

function linkMatches(link: ThreadLink | undefined, filters: Filters): boolean {
  if (
    filters.taskIds === undefined &&
    filters.threadIds === undefined &&
    filters.rounds === undefined
  )
    return true;
  if (link === undefined) return false;
  return (
    overlaps(filters.taskIds, link.taskIds) &&
    overlaps(filters.threadIds, [link.threadId]) &&
    overlaps(filters.rounds, link.rounds)
  );
}

const sessionFiltered = (filters: Filters): boolean =>
  filters.roles !== undefined ||
  filters.taskIds !== undefined ||
  filters.threadIds !== undefined ||
  filters.rounds !== undefined;

function allowedFiles(
  database: DatabaseSync,
  links: ReadonlyMap<string, ThreadLink>,
  filters: Filters,
): string[] {
  const rows = database
    .prepare("SELECT path, orchestrator FROM files")
    .all() as unknown as FileInfoRow[];
  return rows
    .filter((row) => {
      const link = links.get(row.path);
      const role = sessionRole(link, row.orchestrator === 1);
      return (
        (filters.roles === undefined || filters.roles.includes(role)) && linkMatches(link, filters)
      );
    })
    .map((row) => row.path);
}

interface Clause {
  sql: string;
  values: (string | number)[];
}

function listClause(column: string, values: readonly (string | number)[] | undefined): Clause[] {
  if (values === undefined) return [];
  return [
    { sql: `${column} IN (SELECT value FROM json_each(?))`, values: [JSON.stringify(values)] },
  ];
}

function clauses(filters: Filters, files: string[] | undefined): Clause[] {
  return [
    { sql: "(p.tool IS NULL OR p.tool != ?)", values: [OWN_TOOL] },
    ...listClause("p.kind", filters.kinds),
    ...listClause("p.tool", filters.tools),
    ...listClause("f.path", files),
    ...(filters.cwd === undefined
      ? []
      : [{ sql: "substr(f.cwd, 1, length(?)) = ?", values: [filters.cwd, filters.cwd] }]),
    ...(filters.since === undefined ? [] : [{ sql: "p.at >= ?", values: [filters.since] }]),
    ...(filters.until === undefined ? [] : [{ sql: "p.at < ?", values: [filters.until] }]),
  ];
}

function locate(
  database: DatabaseSync,
  links: ReadonlyMap<string, ThreadLink>,
  request: { query: string; filters: Filters; order: Order; limit: number },
): Located[] {
  const expression = terms.matchExpression(request.query);
  if (expression === "") return [];
  const files = sessionFiltered(request.filters)
    ? allowedFiles(database, links, request.filters)
    : undefined;
  const where = clauses(request.filters, files);
  const rows = database
    .prepare(
      `SELECT f.path, f.session_id, f.cwd, f.started_at, f.orchestrator,
         p.offset, p.length, p.part, p.kind, p.tool, p.entry_id, p.at
       FROM parts_fts
       JOIN parts p ON p.id = parts_fts.rowid
       JOIN files f ON f.id = p.file_id
       WHERE parts_fts MATCH ?${where.map((clause) => ` AND ${clause.sql}`).join("")}
       ORDER BY ${ORDER_SQL[request.order]} LIMIT ?`,
    )
    .all(
      expression,
      ...where.flatMap((clause) => clause.values),
      request.limit,
    ) as unknown as HitRow[];
  return rows.map((row) => {
    const link = links.get(row.path);
    return {
      at: row.at,
      entryId: row.entry_id,
      kind: row.kind,
      length: row.length,
      offset: row.offset,
      part: row.part,
      session: {
        cwd: row.cwd,
        link,
        path: row.path,
        role: sessionRole(link, row.orchestrator === 1),
        sessionId: row.session_id,
        startedAt: row.started_at,
      },
      tool: row.tool,
    };
  });
}

const BEFORE = 120;
const AFTER = 240;

function snippet(text: string, query: string): string {
  const normalized = text.normalize("NFKC");
  const match = terms.highlightPattern(query)?.exec(normalized);
  const start = match === undefined || match === null ? 0 : Math.max(0, match.index - BEFORE);
  const end = Math.min(normalized.length, (match?.index ?? 0) + (match?.[0].length ?? 0) + AFTER);
  const body = normalized.slice(start, end).replaceAll(/\s+/gu, " ").trim();
  return `${start > 0 ? "…" : ""}${body}${end < normalized.length ? "…" : ""}`;
}

const search = { OWN_TOOL, locate, snippet };

export default search;
