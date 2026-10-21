import type DatabaseSync from "../platform/node/sqlite.ts";
import taskRows from "./task-rows.ts";
import type taskStoreInternalTypes from "./task-store-internal.types.ts";
import type orchestratorTypesTypes from "./types.types.ts";

const { toTask } = taskRows;

function insertRound(
  database: DatabaseSync,
  project: string,
  id: string,
  title: string,
  now: number,
): void {
  database
    .prepare("INSERT OR IGNORE INTO rounds (id, project, title, created_at) VALUES (?, ?, ?, ?)")
    .run(id, project, title, now);
}

function listRoundIds(database: DatabaseSync, project: string): { id: string; title: string }[] {
  return database
    .prepare("SELECT id, title FROM rounds WHERE project = ? ORDER BY created_at, id")
    .all(project) as unknown as { id: string; title: string }[];
}

function reviewTaskOfRound(
  database: DatabaseSync,
  project: string,
  round: string,
): orchestratorTypesTypes.Task | undefined {
  const row = database
    .prepare("SELECT * FROM tasks WHERE project = ? AND round = ? AND kind = 'review' LIMIT 1")
    .get(project, round) as taskStoreInternalTypes.TaskRow | undefined;
  return row === undefined ? undefined : toTask(row);
}

function workTasksOfRound(
  database: DatabaseSync,
  project: string,
  round: string,
): orchestratorTypesTypes.Task[] {
  const rows = database
    .prepare(
      "SELECT * FROM tasks WHERE project = ? AND round = ? AND kind = 'work' ORDER BY created_at, id",
    )
    .all(project, round) as unknown as taskStoreInternalTypes.TaskRow[];
  return rows.map(toTask);
}

const taskRounds = { insertRound, listRoundIds, reviewTaskOfRound, workTasksOfRound };

export default taskRounds;
