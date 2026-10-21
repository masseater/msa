import testing from "@msa/testing";
import { Effect } from "effect";
import { afterEach, expect, it } from "vite-plus/test";

import dbModule from "../src/core/orchestrator/db.ts";

const { db } = dbModule;

const { joinPath, makeTempDir, pathExists, removePath, runTest } = testing;

const directories: string[] = [];

afterEach(() =>
  runTest(
    Effect.gen(function* () {
      for (const directory of directories.splice(0)) yield* removePath(directory);
    }),
  ),
);

const createsTheDatabaseAndItsMissingParent = () =>
  runTest(
    Effect.gen(function* () {
      const root = yield* makeTempDir("msa-orchestrator-open-");
      directories.push(root);
      const path = joinPath(root, "agent", "nested", "orchestrator.db");

      const database = db.openDatabase(path);
      database.close();

      expect(yield* pathExists(path)).toBe(true);
    }),
  );

it(
  "creates the database and its missing parent directories",
  createsTheDatabaseAndItsMissingParent,
);
