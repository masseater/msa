import migrationsPart1 from "./migrations-part1.ts";
import migrationsPart2 from "./migrations-part2.ts";
import migrationsPart3 from "./migrations-part3.ts";

const { migrateAuthToAuthJson, migrateSessionsFromAgentRoot } = migrationsPart1;
const { runMigrations } = migrationsPart3;
const { showDeprecationWarnings } = migrationsPart2;

const migrations = {
  migrateAuthToAuthJson,
  migrateSessionsFromAgentRoot,
  runMigrations,
  showDeprecationWarnings,
};

export default migrations;
