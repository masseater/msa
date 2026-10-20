import { BACKGROUND_CONTEXT as context } from "@msa/chord/context";
import { Effect } from "effect";
import { dual } from "effect/Function";

import type durableTypes from "../src/index.types.ts";
import nodeModule from "../src/storage/jsonl/node.ts";
import memory from "../src/storage/memory.ts";
import node from "../src/storage/sqlite/node.ts";
import effectSupport from "./effect-support.ts";
import platformSupport from "./platform-support.ts";
import type toolOutputStorageTypes from "./tool-output-storage.types.ts";

const { MemoryStorage } = memory;
const { openNodeSqliteStorage } = node;
const { openNodeJsonlStorage } = nodeModule;

const { awaited } = effectSupport;
const { fileSize, joinPath, listDirectory, pathExists } = platformSupport;

function openStorageImpl(
  backend: toolOutputStorageTypes.Backend,
  path: string,
): Promise<durableTypes.Storage> {
  if (backend === "memory") return Promise.resolve(new MemoryStorage());
  if (backend === "sqlite") return Promise.resolve(openNodeSqliteStorage(path));
  return Promise.resolve(openNodeJsonlStorage(path, context));
}

const openStorage: {
  (path: string): (backend: toolOutputStorageTypes.Backend) => ReturnType<typeof openStorageImpl>;
  (backend: toolOutputStorageTypes.Backend, path: string): ReturnType<typeof openStorageImpl>;
} = dual(2, openStorageImpl);

function timedImpl(storage: durableTypes.Storage, latencies: number[]): durableTypes.Storage {
  return new Proxy(storage, {
    get(target, property) {
      const value = Reflect.get(target, property, target);
      if (property !== "commit" || typeof value !== "function") {
        return typeof value === "function" ? value.bind(target) : value;
      }
      return (...args: unknown[]) =>
        Effect.runPromise(
          Effect.gen(function* () {
            const start = performance.now();
            return yield* Effect.suspend(() => awaited(value.apply(target, args))).pipe(
              Effect.ensuring(
                Effect.sync(() => {
                  latencies.push(performance.now() - start);
                }),
              ),
            );
          }),
        );
    },
  });
}

const timed: {
  (latencies: number[]): (storage: durableTypes.Storage) => ReturnType<typeof timedImpl>;
  (storage: durableTypes.Storage, latencies: number[]): ReturnType<typeof timedImpl>;
} = dual(2, timedImpl);

const footprint = Effect.fn("footprint")(function* (
  backend: toolOutputStorageTypes.Backend,
  path: string,
) {
  if (backend === "sqlite") {
    let bytes = 0;
    for (const suffix of ["", "-wal", "-shm"])
      if (yield* pathExists(path + suffix)) bytes += yield* fileSize(path + suffix);
    return Math.round(bytes / 1024);
  }
  let bytes = 0;
  for (const file of yield* listDirectory(path)) bytes += yield* fileSize(joinPath(path, file));
  return Math.round(bytes / 1024);
});

const toolOutputStorage = {
  footprint,
  openStorage,
  timed,
};

export default toolOutputStorage;
