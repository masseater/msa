import type DatabaseSync from "../platform/node/sqlite.ts";

function reaches(database: DatabaseSync, from: string, target: string): boolean {
  const row = database
    .prepare(
      `WITH RECURSIVE reach(id) AS (
         SELECT ?
         UNION
         SELECT d.depends_on FROM task_dependencies d JOIN reach r ON d.task_id = r.id
       )
       SELECT 1 AS found FROM reach WHERE id = ? LIMIT 1`,
    )
    .get(from, target);
  return row !== undefined;
}

const dependencyReach = { reaches };

export default dependencyReach;
