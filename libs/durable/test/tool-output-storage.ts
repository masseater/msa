import { readdir, stat } from "node:fs/promises";

import { BACKGROUND_CONTEXT as context } from "@msa/chord/context";
import { Effect } from "effect";

import type { Storage } from "../src/index.ts";
import { openNodeJsonlStorage } from "../src/storage/jsonl/node.ts";
import { MemoryStorage } from "../src/storage/memory.ts";
import { openNodeSqliteStorage } from "../src/storage/sqlite/node.ts";
import { awaited } from "./effect-support.ts";
import { joinPath } from "./platform-support.ts";

export type Backend = "memory" | "sqlite" | "jsonl";

export function openStorage(backend: Backend, path: string): Promise<Storage> {
  if (backend === "memory") return Promise.resolve(new MemoryStorage());
  if (backend === "sqlite") return Promise.resolve(openNodeSqliteStorage(path));
  return Promise.resolve(openNodeJsonlStorage(path, context));
}

export function timed(storage: Storage, latencies: number[]): Storage {
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

export const footprint = Effect.fn("footprint")(function* (backend: Backend, path: string) {
  if (backend === "sqlite") {
    let bytes = 0;
    for (const suffix of ["", "-wal", "-shm"])
      bytes += (yield* awaited(stat(path + suffix).catch(() => undefined)))?.size ?? 0;
    return Math.round(bytes / 1024);
  }
  let bytes = 0;
  for (const file of yield* awaited(readdir(path)))
    bytes += (yield* awaited(stat(joinPath(path, file)))).size;
  return Math.round(bytes / 1024);
});
