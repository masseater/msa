import { DatabaseSync } from "node:sqlite";

import * as NodeServices from "@effect/platform-node/NodeServices";
import { Effect, FileSystem, Function, ManagedRuntime, Path } from "effect";

import NodeSqliteDatabase from "./node-database.ts";
import type nodeTypes from "./node.types.ts";
import SqliteStorage from "./storage.ts";

const nodeRuntime = ManagedRuntime.make(NodeServices.layer);

const DEFAULT_WAL_AUTO_CHECKPOINT_PAGES = 1_000;
const DEFAULT_BUSY_TIMEOUT_MS = 5_000;

const makeParentDirectory = Effect.fnUntraced(function* (path: string) {
  const fs = yield* FileSystem.FileSystem;
  const paths = yield* Path.Path;
  yield* fs.makeDirectory(paths.dirname(path), { recursive: true });
});

const prepareDirectory = (path: string) =>
  path === ":memory:"
    ? Effect.void
    : makeParentDirectory(path).pipe(Effect.mapError((error) => error.cause ?? error));

const configure = Effect.fnUntraced(function* (
  adapter: NodeSqliteDatabase,
  checkpointPages: number,
) {
  yield* Effect.promise(() => adapter.exec("PRAGMA journal_mode = WAL"));
  yield* Effect.promise(() => adapter.exec("PRAGMA synchronous = NORMAL"));
  yield* Effect.promise(() => adapter.exec(`PRAGMA wal_autocheckpoint = ${checkpointPages}`));
});

const openDatabase = Effect.fnUntraced(function* (
  path: string,
  options: nodeTypes.NodeSqliteStorageOptions,
) {
  const checkpointPages = options.walAutoCheckpointPages ?? DEFAULT_WAL_AUTO_CHECKPOINT_PAGES;
  const timeout = options.busyTimeoutMs ?? DEFAULT_BUSY_TIMEOUT_MS;
  yield* prepareDirectory(path);
  const adapter = new NodeSqliteDatabase(new DatabaseSync(path, { timeout }));
  yield* configure(adapter, checkpointPages).pipe(
    Effect.onError(() => Effect.ignoreCause(Effect.promise(() => adapter.close()))),
  );
  return adapter;
});

type Open<T> = {
  (options?: nodeTypes.NodeSqliteStorageOptions): (path: string) => Promise<T>;
  (path: string, options?: nodeTypes.NodeSqliteStorageOptions): Promise<T>;
};

const isPath = (args: IArguments): boolean => typeof args[0] === "string";

const openNodeSqliteDatabase: Open<NodeSqliteDatabase> = Function.dual(
  isPath,
  (path: string, options: nodeTypes.NodeSqliteStorageOptions = {}): Promise<NodeSqliteDatabase> =>
    nodeRuntime.runPromise(openDatabase(path, options)),
);

const openNodeSqliteStorage: Open<nodeTypes.SqliteStorage> = Function.dual(
  isPath,
  (
    path: string,
    options: nodeTypes.NodeSqliteStorageOptions = {},
  ): Promise<nodeTypes.SqliteStorage> =>
    nodeRuntime.runPromise(
      openDatabase(path, options).pipe(
        Effect.flatMap((database) => Effect.promise(() => SqliteStorage.open(database))),
      ),
    ),
);

const node = {
  NodeSqliteDatabase,
  openNodeSqliteDatabase,
  openNodeSqliteStorage,
};

export default node;
