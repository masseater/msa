import type { DatabaseSync } from "node:sqlite";

import dbModule from "./db.ts";
import type orchestratorTypesTypes from "./types.types.ts";

const { db } = dbModule;

interface NoteRow {
  id: string;
  project: string;
  round: string | null;
  content: string;
  author: string;
  created_at: number;
}

function targetsOf(database: DatabaseSync, noteId: string): string[] {
  const rows = database
    .prepare("SELECT task_id FROM note_targets WHERE note_id = ? ORDER BY task_id")
    .all(noteId) as unknown as { task_id: string }[];
  return rows.map((row) => row.task_id);
}

function toNote(database: DatabaseSync, row: NoteRow): orchestratorTypesTypes.Note {
  return {
    author: row.author,
    content: row.content,
    createdAt: row.created_at,
    id: row.id,
    project: row.project,
    round: row.round,
    taskIds: targetsOf(database, row.id),
  };
}

function insertNote(database: DatabaseSync, note: orchestratorTypesTypes.Note): void {
  db.transaction(database, () => {
    database
      .prepare(
        "INSERT INTO notes (id, project, round, content, author, created_at) VALUES (?, ?, ?, ?, ?, ?)",
      )
      .run(note.id, note.project, note.round, note.content, note.author, note.createdAt);
    for (const taskId of note.taskIds) {
      database
        .prepare("INSERT INTO note_targets (note_id, task_id) VALUES (?, ?)")
        .run(note.id, taskId);
    }
  });
}

function listNotes(database: DatabaseSync, project: string): orchestratorTypesTypes.Note[] {
  const rows = database
    .prepare("SELECT * FROM notes WHERE project = ? ORDER BY created_at, id")
    .all(project) as unknown as NoteRow[];
  return rows.map((row) => toNote(database, row));
}

function unreadNotes(
  database: DatabaseSync,
  project: string,
  taskId: string,
  threadId: string,
): orchestratorTypesTypes.Note[] {
  const rows = database
    .prepare(
      `SELECT n.* FROM notes n
       WHERE n.project = ?
         AND (
           (n.round IS NULL AND NOT EXISTS (SELECT 1 FROM note_targets t WHERE t.note_id = n.id))
           OR n.round = (SELECT round FROM tasks WHERE id = ?)
           OR EXISTS (SELECT 1 FROM note_targets t WHERE t.note_id = n.id AND t.task_id = ?)
         )
         AND NOT EXISTS (
           SELECT 1 FROM note_reads r WHERE r.note_id = n.id AND r.thread_id = ?
         )
       ORDER BY n.created_at, n.id`,
    )
    .all(project, taskId, taskId, threadId) as unknown as NoteRow[];
  return rows.map((row) => toNote(database, row));
}

function markNoteRead(database: DatabaseSync, noteId: string, threadId: string, now: number): void {
  database
    .prepare("INSERT OR IGNORE INTO note_reads (note_id, thread_id, read_at) VALUES (?, ?, ?)")
    .run(noteId, threadId, now);
}

function noteRead(database: DatabaseSync, noteId: string, threadId: string): boolean {
  const row = database
    .prepare("SELECT 1 AS found FROM note_reads WHERE note_id = ? AND thread_id = ?")
    .get(noteId, threadId);
  return row !== undefined;
}

function deleteNote(database: DatabaseSync, noteId: string): void {
  database.prepare("DELETE FROM note_reads WHERE note_id = ?").run(noteId);
  database.prepare("DELETE FROM note_targets WHERE note_id = ?").run(noteId);
  database.prepare("DELETE FROM notes WHERE id = ?").run(noteId);
}

const noteStore = {
  deleteNote,
  insertNote,
  listNotes,
  markNoteRead,
  noteRead,
  unreadNotes,
};

const noteStoreModule = {
  noteStore,
};

export default noteStoreModule;
