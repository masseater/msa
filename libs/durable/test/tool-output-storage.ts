import { readdir, stat } from "node:fs/promises";
import { join } from "node:path";

import { BACKGROUND_CONTEXT as context } from "@msa/chord/context";

import { MemoryStorage, type Storage } from "../src/index.ts";
import { openNodeJsonlStorage } from "../src/storage/jsonl/node.ts";
import { openNodeSqliteStorage } from "../src/storage/sqlite/node.ts";

export type Backend = "memory" | "sqlite" | "jsonl";

export function openStorage(backend: Backend, path: string): Promise<Storage> {
  if (backend === "memory") return Promise.resolve(new MemoryStorage());
  if (backend === "sqlite") return Promise.resolve(openNodeSqliteStorage(path));
  return Promise.resolve(openNodeJsonlStorage(path, context));
}

// Measure every Storage commit.
export function timed(storage: Storage, latencies: number[]): Storage {
  return new Proxy(storage, {
    get(target, property) {
      const value = Reflect.get(target, property, target);
      if (property !== "commit" || typeof value !== "function") {
        return typeof value === "function" ? value.bind(target) : value;
      }
      return async (...args: unknown[]) => {
        const start = performance.now();
        try {
          return await value.apply(target, args);
        } finally {
          latencies.push(performance.now() - start);
        }
      };
    },
  });
}

export async function footprint(backend: Backend, path: string): Promise<number> {
  if (backend === "sqlite") {
    let bytes = 0;
    for await (const suffix of ["", "-wal", "-shm"])
      bytes += (await stat(path + suffix).catch(() => undefined))?.size ?? 0;
    return Math.round(bytes / 1024);
  }
  let bytes = 0;
  for await (const file of await readdir(path)) bytes += (await stat(join(path, file))).size;
  return Math.round(bytes / 1024);
}
