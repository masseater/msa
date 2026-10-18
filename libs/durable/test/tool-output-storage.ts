import { BACKGROUND_CONTEXT as context } from "@msa/chord/context";
import { Effect } from "effect";
import { dual } from "effect/Function";

import type { Storage } from "../src/index.ts";
import { openNodeJsonlStorage } from "../src/storage/jsonl/node.ts";
import { MemoryStorage } from "../src/storage/memory.ts";
import { openNodeSqliteStorage } from "../src/storage/sqlite/node.ts";
import { awaited } from "./effect-support.ts";
import { fileSize, joinPath, listDirectory, pathExists } from "./platform-support.ts";

export type Backend = "memory" | "sqlite" | "jsonl";

function openStorageImpl(backend: Backend, path: string): Promise<Storage> {
  if (backend === "memory") return Promise.resolve(new MemoryStorage());
  if (backend === "sqlite") return Promise.resolve(openNodeSqliteStorage(path));
  return Promise.resolve(openNodeJsonlStorage(path, context));
}

export const openStorage: {
  (path: string): (backend: Backend) => ReturnType<typeof openStorageImpl>;
  (backend: Backend, path: string): ReturnType<typeof openStorageImpl>;
} = dual(2, openStorageImpl);

function timedImpl(storage: Storage, latencies: number[]): Storage {
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

export const timed: {
  (latencies: number[]): (storage: Storage) => ReturnType<typeof timedImpl>;
  (storage: Storage, latencies: number[]): ReturnType<typeof timedImpl>;
} = dual(2, timedImpl);

export const footprint = Effect.fn("footprint")(function* (backend: Backend, path: string) {
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
