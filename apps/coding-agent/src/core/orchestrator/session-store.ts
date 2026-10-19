import type { DatabaseSync } from "node:sqlite";

import { db } from "./db.ts";
import { searchQuery, segmentWords } from "./text.ts";
import type {
  Assignment,
  Report,
  ReportHit,
  Session,
  SessionRole,
  SessionStatus,
  SessionView,
} from "./types.ts";

interface SessionRow {
  id: string;
  project: string;
  model: string;
  thinking_level: string;
  cwd: string;
  status: string;
  session_file: string | null;
  created_at: number;
  updated_at: number;
}

interface AssignmentRow {
  task_id: string;
  session_id: string;
  role: string;
  created_at: number;
}

interface ReportRow {
  id: string;
  task_id: string;
  session_id: string;
  role: string;
  status: string;
  content: string;
  created_at: number;
}

function toSession(row: SessionRow): Session {
  return {
    id: row.id,
    project: row.project,
    model: row.model,
    thinkingLevel: row.thinking_level as Session["thinkingLevel"],
    cwd: row.cwd,
    status: row.status as SessionStatus,
    sessionFile: row.session_file,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

function toAssignment(row: AssignmentRow): Assignment {
  return {
    taskId: row.task_id,
    sessionId: row.session_id,
    role: row.role as SessionRole,
    createdAt: row.created_at,
  };
}

function toReport(row: ReportRow): Report {
  return {
    id: row.id,
    taskId: row.task_id,
    sessionId: row.session_id,
    role: row.role as SessionRole,
    status: row.status as SessionStatus,
    content: row.content,
    createdAt: row.created_at,
  };
}

function insertSession(database: DatabaseSync, session: Session): void {
  database
    .prepare(
      `INSERT INTO sessions (id, project, model, thinking_level, cwd, status, session_file,
         created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    )
    .run(
      session.id,
      session.project,
      session.model,
      session.thinkingLevel,
      session.cwd,
      session.status,
      session.sessionFile,
      session.createdAt,
      session.updatedAt,
    );
}

function getSession(database: DatabaseSync, id: string): Session | undefined {
  const row = database.prepare("SELECT * FROM sessions WHERE id = ?").get(id) as
    | SessionRow
    | undefined;
  return row === undefined ? undefined : toSession(row);
}

const SESSION_COLUMNS: Readonly<Record<string, string>> = {
  model: "model",
  thinkingLevel: "thinking_level",
  status: "status",
  sessionFile: "session_file",
};

function updateSession(
  database: DatabaseSync,
  id: string,
  patch: Partial<Pick<Session, "model" | "thinkingLevel" | "status" | "sessionFile">>,
  now: number,
): void {
  const entries = db
    .definedEntries(patch)
    .map(([key, value]) => [SESSION_COLUMNS[key] ?? key, value]) as [string, string | null][];
  if (entries.length === 0) return;
  const assignments = entries.map(([column]) => `${column} = ?`).join(", ");
  database
    .prepare(`UPDATE sessions SET ${assignments}, updated_at = ? WHERE id = ?`)
    .run(...entries.map(([, value]) => value), now, id);
}

function listSessions(database: DatabaseSync, project: string): Session[] {
  const rows = database
    .prepare("SELECT * FROM sessions WHERE project = ? ORDER BY created_at, id")
    .all(project) as unknown as SessionRow[];
  return rows.map(toSession);
}

function runningSessions(database: DatabaseSync, project: string): Session[] {
  const rows = database
    .prepare("SELECT * FROM sessions WHERE project = ? AND status = 'running'")
    .all(project) as unknown as SessionRow[];
  return rows.map(toSession);
}

function insertAssignment(database: DatabaseSync, assignment: Assignment): void {
  database
    .prepare(
      "INSERT OR IGNORE INTO assignments (task_id, session_id, role, created_at) VALUES (?, ?, ?, ?)",
    )
    .run(assignment.taskId, assignment.sessionId, assignment.role, assignment.createdAt);
}

function listAssignments(database: DatabaseSync, project: string): Assignment[] {
  const rows = database
    .prepare(
      `SELECT a.* FROM assignments a JOIN tasks t ON t.id = a.task_id
       WHERE t.project = ? ORDER BY a.created_at, a.task_id`,
    )
    .all(project) as unknown as AssignmentRow[];
  return rows.map(toAssignment);
}

function assignmentsOfSession(database: DatabaseSync, sessionId: string): Assignment[] {
  const rows = database
    .prepare("SELECT * FROM assignments WHERE session_id = ? ORDER BY created_at, task_id")
    .all(sessionId) as unknown as AssignmentRow[];
  return rows.map(toAssignment);
}

function deleteAssignmentsOfSession(database: DatabaseSync, sessionId: string): void {
  database.prepare("DELETE FROM assignments WHERE session_id = ?").run(sessionId);
}

function assignmentsOfTask(database: DatabaseSync, taskId: string): Assignment[] {
  const rows = database
    .prepare("SELECT * FROM assignments WHERE task_id = ? ORDER BY created_at, session_id")
    .all(taskId) as unknown as AssignmentRow[];
  return rows.map(toAssignment);
}

function sessionViews(database: DatabaseSync, project: string): SessionView[] {
  const sessions = listSessions(database, project);
  const assignments = listAssignments(database, project);
  return sessions.map((session) =>
    Object.assign(session, {
      tasks: assignments
        .filter((assignment) => assignment.sessionId === session.id)
        .map((assignment) => ({ taskId: assignment.taskId, role: assignment.role })),
    }),
  );
}

function insertReport(database: DatabaseSync, report: Report): void {
  db.transaction(database, () => {
    database
      .prepare(
        `INSERT INTO reports (id, task_id, session_id, role, status, content, created_at)
         VALUES (?, ?, ?, ?, ?, ?, ?)`,
      )
      .run(
        report.id,
        report.taskId,
        report.sessionId,
        report.role,
        report.status,
        report.content,
        report.createdAt,
      );
    database
      .prepare("INSERT INTO reports_fts (report_id, terms) VALUES (?, ?)")
      .run(report.id, segmentWords(report.content).join(" "));
  });
}

function reportsOfTask(database: DatabaseSync, taskId: string): Report[] {
  const rows = database
    .prepare("SELECT * FROM reports WHERE task_id = ? ORDER BY created_at, id")
    .all(taskId) as unknown as ReportRow[];
  return rows.map(toReport);
}

function listReports(database: DatabaseSync, project: string): Report[] {
  const rows = database
    .prepare(
      `SELECT r.* FROM reports r JOIN tasks t ON t.id = r.task_id
       WHERE t.project = ? ORDER BY r.created_at, r.id`,
    )
    .all(project) as unknown as ReportRow[];
  return rows.map(toReport);
}

function searchReports(
  database: DatabaseSync,
  project: string,
  text: string,
  limit: number,
): ReportHit[] {
  const query = searchQuery(text);
  if (query === "") return [];
  const rows = database
    .prepare(
      `SELECT r.*, t.title AS task_title, s.model AS session_model
       FROM reports_fts f
       JOIN reports r ON r.id = f.report_id
       JOIN tasks t ON t.id = r.task_id
       JOIN sessions s ON s.id = r.session_id
       WHERE reports_fts MATCH ? AND t.project = ?
       ORDER BY bm25(reports_fts) LIMIT ?`,
    )
    .all(query, project, limit) as unknown as (ReportRow & {
    task_title: string;
    session_model: string;
  })[];
  return rows.map((row) => ({
    report: toReport(row),
    taskTitle: row.task_title,
    sessionModel: row.session_model,
  }));
}

export const sessionStore = {
  insertSession,
  getSession,
  updateSession,
  listSessions,
  runningSessions,
  insertAssignment,
  listAssignments,
  assignmentsOfSession,
  assignmentsOfTask,
  deleteAssignmentsOfSession,
  sessionViews,
  insertReport,
  reportsOfTask,
  listReports,
  searchReports,
};
