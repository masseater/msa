import DatabaseSync from "../platform/node/sqlite.ts";
import type sessionSearchTypes from "./session-search.types.ts";

type ThreadLink = sessionSearchTypes.ThreadLink;
type SessionRole = sessionSearchTypes.SessionRole;

interface LinkRow {
  thread_id: string;
  session_file: string;
  role: string | null;
  task_id: string | null;
  round: string | null;
}

const THREAD_ROLES: readonly SessionRole[] = ["worker", "reviewer", "triage", "advisor"];

const LINK_QUERY = `SELECT t.id AS thread_id, t.session_file, a.role, a.task_id, k.round
  FROM threads t
  LEFT JOIN assignments a ON a.thread_id = t.id
  LEFT JOIN tasks k ON k.id = a.task_id
  WHERE t.session_file IS NOT NULL
  ORDER BY a.created_at`;

function readRows(path: string): LinkRow[] {
  try {
    const database = new DatabaseSync(path, { readOnly: true, timeout: 5000 });
    try {
      return database.prepare(LINK_QUERY).all() as unknown as LinkRow[];
    } finally {
      database.close();
    }
  } catch {
    return [];
  }
}

const unique = (values: readonly (string | null)[]): string[] => [
  ...new Set(values.filter((value): value is string => value !== null && value !== "")),
];

function threadLinks(orchestratorDatabase: string): Map<string, ThreadLink> {
  const grouped = new Map<string, LinkRow[]>();
  for (const row of readRows(orchestratorDatabase)) {
    const rows = grouped.get(row.session_file) ?? [];
    rows.push(row);
    grouped.set(row.session_file, rows);
  }
  return new Map(
    [...grouped].map(([path, rows]) => [
      path,
      {
        roles: unique(rows.map((row) => row.role)),
        rounds: unique(rows.map((row) => row.round)),
        taskIds: unique(rows.map((row) => row.task_id)),
        threadId: rows[0]?.thread_id ?? "",
      },
    ]),
  );
}

function sessionRole(link: ThreadLink | undefined, orchestrator: boolean): SessionRole {
  const role = THREAD_ROLES.find((candidate) => link?.roles.includes(candidate) === true);
  if (role !== undefined) return role;
  return orchestrator ? "orchestrator" : "session";
}

const threadLinksModule = { sessionRole, threadLinks };

export default threadLinksModule;
