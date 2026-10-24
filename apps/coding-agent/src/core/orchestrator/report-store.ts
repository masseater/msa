import type DatabaseSync from "../platform/node/sqlite.ts";
import dbModule from "./db.ts";
import textModule from "./text.ts";
import type orchestratorTypesTypes from "./types.types.ts";

const { db } = dbModule;
const { searchQuery, segmentWords } = textModule;

interface ReportRow {
  id: string;
  task_id: string;
  thread_id: string;
  role: string;
  status: string;
  content: string;
  verdict: string | null;
  created_at: number;
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
    verdict: row.verdict as orchestratorTypesTypes.ReviewVerdictResult | null,
  };
}

function insertReport(database: DatabaseSync, report: orchestratorTypesTypes.Report): void {
  db.transaction(database, () => {
    database
      .prepare(
        `INSERT INTO reports (id, task_id, thread_id, role, status, content, verdict, created_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
      )
      .run(
        report.id,
        report.taskId,
        report.threadId,
        report.role,
        report.status,
        report.content,
        report.verdict,
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

const reportStore = { insertReport, listReports, reportsOfTask, searchReports };

const reportStoreModule = { reportStore };

export default reportStoreModule;
