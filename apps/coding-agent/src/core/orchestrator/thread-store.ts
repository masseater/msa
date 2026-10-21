import type DatabaseSync from "../platform/node/sqlite.ts";
import dbModule from "./db.ts";
import textModule from "./text.ts";
import type orchestratorTypesTypes from "./types.types.ts";

const { db } = dbModule;
const { searchQuery, segmentWords } = textModule;

interface ThreadRow {
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
  thread_id: string;
  role: string;
  created_at: number;
}

interface ReportRow {
  id: string;
  task_id: string;
  thread_id: string;
  role: string;
  status: string;
  content: string;
  created_at: number;
}

function toThread(row: ThreadRow): orchestratorTypesTypes.Thread {
  return {
    createdAt: row.created_at,
    cwd: row.cwd,
    id: row.id,
    model: row.model,
    project: row.project,
    sessionFile: row.session_file,
    status: row.status as orchestratorTypesTypes.ThreadStatus,
    thinkingLevel: row.thinking_level as orchestratorTypesTypes.Thread["thinkingLevel"],
    updatedAt: row.updated_at,
  };
}

function toAssignment(row: AssignmentRow): orchestratorTypesTypes.Assignment {
  return {
    createdAt: row.created_at,
    role: row.role as orchestratorTypesTypes.ThreadRole,
    taskId: row.task_id,
    threadId: row.thread_id,
  };
}

function toReport(row: ReportRow): orchestratorTypesTypes.Report {
  return {
    content: row.content,
    createdAt: row.created_at,
    id: row.id,
    role: row.role as orchestratorTypesTypes.ThreadRole,
    status: row.status as orchestratorTypesTypes.ThreadStatus,
    taskId: row.task_id,
    threadId: row.thread_id,
  };
}

function insertThread(database: DatabaseSync, thread: orchestratorTypesTypes.Thread): void {
  database
    .prepare(
      `INSERT INTO threads (id, project, model, thinking_level, cwd, status, session_file,
         created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    )
    .run(
      thread.id,
      thread.project,
      thread.model,
      thread.thinkingLevel,
      thread.cwd,
      thread.status,
      thread.sessionFile,
      thread.createdAt,
      thread.updatedAt,
    );
}

function getThread(database: DatabaseSync, id: string): orchestratorTypesTypes.Thread | undefined {
  const row = database.prepare("SELECT * FROM threads WHERE id = ?").get(id) as
    | ThreadRow
    | undefined;
  return row === undefined ? undefined : toThread(row);
}

const THREAD_COLUMNS: Readonly<Record<string, string>> = {
  model: "model",
  sessionFile: "session_file",
  status: "status",
  thinkingLevel: "thinking_level",
};

function updateThread(
  database: DatabaseSync,
  id: string,
  patch: Partial<
    Pick<orchestratorTypesTypes.Thread, "model" | "thinkingLevel" | "status" | "sessionFile">
  >,
  now: number,
): void {
  const entries = db
    .definedEntries(patch)
    .map(([key, value]) => [THREAD_COLUMNS[key] ?? key, value]) as [string, string | null][];
  if (entries.length === 0) return;
  const assignments = entries.map(([column]) => `${column} = ?`).join(", ");
  database
    .prepare(`UPDATE threads SET ${assignments}, updated_at = ? WHERE id = ?`)
    .run(...entries.map(([, value]) => value), now, id);
}

function listThreads(database: DatabaseSync, project: string): orchestratorTypesTypes.Thread[] {
  const rows = database
    .prepare("SELECT * FROM threads WHERE project = ? ORDER BY created_at, id")
    .all(project) as unknown as ThreadRow[];
  return rows.map(toThread);
}

function runningThreads(database: DatabaseSync, project: string): orchestratorTypesTypes.Thread[] {
  const rows = database
    .prepare("SELECT * FROM threads WHERE project = ? AND status = 'running'")
    .all(project) as unknown as ThreadRow[];
  return rows.map(toThread);
}

function insertAssignment(
  database: DatabaseSync,
  assignment: orchestratorTypesTypes.Assignment,
): void {
  database
    .prepare(
      "INSERT OR IGNORE INTO assignments (task_id, thread_id, role, created_at) VALUES (?, ?, ?, ?)",
    )
    .run(assignment.taskId, assignment.threadId, assignment.role, assignment.createdAt);
}

function listAssignments(
  database: DatabaseSync,
  project: string,
): orchestratorTypesTypes.Assignment[] {
  const rows = database
    .prepare(
      `SELECT a.* FROM assignments a JOIN tasks t ON t.id = a.task_id
       WHERE t.project = ? ORDER BY a.created_at, a.task_id`,
    )
    .all(project) as unknown as AssignmentRow[];
  return rows.map(toAssignment);
}

function assignmentsOfThread(
  database: DatabaseSync,
  threadId: string,
): orchestratorTypesTypes.Assignment[] {
  const rows = database
    .prepare("SELECT * FROM assignments WHERE thread_id = ? ORDER BY created_at, task_id")
    .all(threadId) as unknown as AssignmentRow[];
  return rows.map(toAssignment);
}

function deleteAssignmentsOfThread(database: DatabaseSync, threadId: string): void {
  database.prepare("DELETE FROM assignments WHERE thread_id = ?").run(threadId);
}

function assignmentsOfTask(
  database: DatabaseSync,
  taskId: string,
): orchestratorTypesTypes.Assignment[] {
  const rows = database
    .prepare("SELECT * FROM assignments WHERE task_id = ? ORDER BY created_at, thread_id")
    .all(taskId) as unknown as AssignmentRow[];
  return rows.map(toAssignment);
}

function threadViews(database: DatabaseSync, project: string): orchestratorTypesTypes.ThreadView[] {
  const threads = listThreads(database, project);
  const assignments = listAssignments(database, project);
  return threads.map((thread) =>
    Object.assign(thread, {
      tasks: assignments
        .filter((assignment) => assignment.threadId === thread.id)
        .map((assignment) => ({ role: assignment.role, taskId: assignment.taskId })),
    }),
  );
}

function insertReport(database: DatabaseSync, report: orchestratorTypesTypes.Report): void {
  db.transaction(database, () => {
    database
      .prepare(
        `INSERT INTO reports (id, task_id, thread_id, role, status, content, created_at)
         VALUES (?, ?, ?, ?, ?, ?, ?)`,
      )
      .run(
        report.id,
        report.taskId,
        report.threadId,
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

function reportsOfTask(database: DatabaseSync, taskId: string): orchestratorTypesTypes.Report[] {
  const rows = database
    .prepare("SELECT * FROM reports WHERE task_id = ? ORDER BY created_at, id")
    .all(taskId) as unknown as ReportRow[];
  return rows.map(toReport);
}

function listReports(database: DatabaseSync, project: string): orchestratorTypesTypes.Report[] {
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
): orchestratorTypesTypes.ReportHit[] {
  const query = searchQuery(text);
  if (query === "") return [];
  const rows = database
    .prepare(
      `SELECT r.*, t.title AS task_title, s.model AS thread_model
       FROM reports_fts f
       JOIN reports r ON r.id = f.report_id
       JOIN tasks t ON t.id = r.task_id
       JOIN threads s ON s.id = r.thread_id
       WHERE reports_fts MATCH ? AND t.project = ?
       ORDER BY bm25(reports_fts) LIMIT ?`,
    )
    .all(query, project, limit) as unknown as (ReportRow & {
    task_title: string;
    thread_model: string;
  })[];
  return rows.map((row) => ({
    report: toReport(row),
    taskTitle: row.task_title,
    threadModel: row.thread_model,
  }));
}

const threadStore = {
  assignmentsOfTask,
  assignmentsOfThread,
  deleteAssignmentsOfThread,
  getThread,
  insertAssignment,
  insertReport,
  insertThread,
  listAssignments,
  listReports,
  listThreads,
  reportsOfTask,
  runningThreads,
  searchReports,
  threadViews,
  updateThread,
};

const threadStoreModule = {
  threadStore,
};

export default threadStoreModule;
