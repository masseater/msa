import { lstat, readdir, stat, statfs } from "node:fs/promises";

import { Cause, Clock, Crypto, Effect, FileSystem, Function, Option } from "effect";
import * as Hex from "effect/encoding/Hex";

import type { Dual2 } from "../dual.ts";
import { nodeRuntime } from "../node-runtime.ts";
import { isNodeError } from "./node-errors.ts";
import type { StatsLike } from "./node-paths.ts";
import { BudgetExceeded, isDenied } from "./node-watch-errors.ts";
import {
  ancestorsOf,
  childOf,
  type Entry,
  excluded,
  type EntryKind,
  type ResolvedTarget,
  type Scan,
  type Snapshot,
} from "./node-watch-scope.ts";

const HASH_MAX_BYTES = 256 * 1024;
const HASH_RECENT_MS = 5000;
const SKIPPED_LIST_ERRORS: ReadonlySet<string> = new Set(["ENOENT", "EACCES", "EPERM", "ENOTDIR"]);

const UNRELIABLE_FILE_SYSTEMS = new Set([
  0x6969, 0x517b, 0xff534d42, 0xfe534d42, 0x65735546, 0x01021997, 0x0bd00bd0, 0x47504653,
  0x00c36400, 0x5346414f, 0x6b414653, 0x5dca2df5,
]);

export type WatchStats = StatsLike & { readonly dev: number; readonly ino: number };

const kindOf = (stats: WatchStats): EntryKind => {
  if (stats.isFile()) return "file";
  if (stats.isDirectory()) return "directory";
  return stats.isSymbolicLink() ? "symlink" : "other";
};

export const entryOf: Dual2<WatchStats, string | undefined, Entry> = Function.dual(
  2,
  (stats: WatchStats, hash: string | undefined): Entry => {
    const kind = kindOf(stats);
    return {
      kind,
      dev: stats.dev,
      ino: stats.ino,
      size: kind === "directory" ? 0 : stats.size,
      mtimeMs: kind === "directory" ? 0 : stats.mtimeMs,
      ...(hash === undefined ? {} : { hash }),
    };
  },
);

const optionalLinkStats = (path: string) =>
  Effect.promise((): Promise<WatchStats | undefined> => lstat(path).catch(() => undefined));

const contentHash = (path: string) =>
  Effect.gen(function* () {
    const fs = yield* FileSystem.FileSystem;
    const crypto = yield* Crypto.Crypto;
    const digest = yield* crypto.digest("SHA-256", yield* fs.readFile(path));
    return Option.some(Hex.encode(digest));
  }).pipe(Effect.catchCause(() => Effect.succeedNone));

export interface ScanRequest {
  readonly targets: readonly ResolvedTarget[];
  readonly mode: "native" | "polling";
  readonly maxDirectories: number;
}

class TreeScan {
  readonly #request: ScanRequest;
  readonly #snapshot: Snapshot = new Map();
  readonly #linkedFiles = new Set<string>();
  readonly #counted = new Set<string>();
  readonly #traversed = new Set<string>();
  readonly #listed = new Map<string, EntryKind>();

  constructor(request: ScanRequest) {
    this.#request = request;
  }

  #countDirectory(path: string): Effect.Effect<void, BudgetExceeded> {
    this.#counted.add(path);
    const max = this.#request.maxDirectories;
    if (this.#counted.size <= max) return Effect.void;
    return Effect.fail(new BudgetExceeded({ message: `Watched paths exceed ${max} directories` }));
  }

  #record(path: string, stats: WatchStats) {
    return Effect.gen({ self: this }, function* () {
      const candidate =
        this.#request.mode === "polling" && stats.isFile() && stats.size <= HASH_MAX_BYTES;
      const recent = candidate && (yield* Clock.currentTimeMillis) - stats.mtimeMs < HASH_RECENT_MS;
      const hash = recent ? yield* contentHash(path) : Option.none();
      this.#snapshot.set(path, entryOf(stats, Option.getOrUndefined(hash)));
    });
  }

  #listDirectory(target: ResolvedTarget, directory: string) {
    return Effect.promise(() => readdir(directory)).pipe(
      Effect.catchCause((cause) => {
        const error = Cause.squash(cause);
        if (directory === target.path && isDenied(error)) return Effect.die(error);
        if (isNodeError(error) && SKIPPED_LIST_ERRORS.has(error.code ?? "")) {
          return Effect.succeed<string[]>([]);
        }
        return Effect.die(error);
      }),
    );
  }

  #scanDirectory(
    index: number,
    target: ResolvedTarget,
    directory: string,
  ): Effect.Effect<void, BudgetExceeded, FileSystem.FileSystem | Crypto.Crypto> {
    return Effect.gen({ self: this }, function* () {
      const key = `${index}\0${directory}`;
      if (this.#traversed.has(key)) return;
      this.#traversed.add(key);
      const names = yield* this.#listDirectory(target, directory);
      for (const name of names) {
        if (excluded(target, name)) continue;
        const path = childOf(directory, name);
        const kind = this.#listed.get(path) ?? (yield* this.#listEntry(path));
        if (kind !== undefined && target.recursive && kind === "directory") {
          yield* this.#countDirectory(path);
          yield* this.#scanDirectory(index, target, path);
        }
      }
    });
  }

  #listEntry(path: string) {
    return Effect.gen({ self: this }, function* () {
      const stats = yield* optionalLinkStats(path);
      if (stats === undefined) return undefined;
      const kind = kindOf(stats);
      this.#listed.set(path, kind);
      if (!this.#snapshot.has(path)) yield* this.#record(path, stats);
      return kind;
    });
  }

  #scanAncestors(target: ResolvedTarget) {
    return Effect.gen({ self: this }, function* () {
      for (const ancestor of ancestorsOf(target.path)) {
        if (this.#snapshot.has(ancestor)) continue;
        const stats = yield* optionalLinkStats(ancestor);
        if (stats !== undefined) {
          this.#snapshot.set(ancestor, { ...entryOf(stats, undefined), size: 0, mtimeMs: 0 });
        }
      }
    });
  }

  #scanTarget(index: number, target: ResolvedTarget) {
    return Effect.gen({ self: this }, function* () {
      yield* this.#scanAncestors(target);
      const found = yield* Effect.promise((): Promise<WatchStats> => stat(target.path)).pipe(
        Effect.asSome,
        Effect.catchCause((cause) => {
          const error = Cause.squash(cause);
          return isDenied(error) ? Effect.die(error) : Effect.succeedNone;
        }),
      );
      if (Option.isNone(found)) return;
      const stats = found.value;
      yield* this.#record(target.path, stats);
      if (stats.isFile() && (yield* optionalLinkStats(target.path))?.isSymbolicLink() === true) {
        this.#linkedFiles.add(target.path);
      }
      if (stats.isDirectory()) {
        yield* this.#countDirectory(target.path);
        yield* this.#scanDirectory(index, target, target.path);
      }
    });
  }

  run(): Effect.Effect<Scan, BudgetExceeded, FileSystem.FileSystem | Crypto.Crypto> {
    return Effect.gen({ self: this }, function* () {
      for (const [index, target] of this.#request.targets.entries()) {
        yield* this.#scanTarget(index, target);
      }
      return { snapshot: this.#snapshot, linkedFiles: this.#linkedFiles };
    });
  }
}

export const scanTargets = (request: ScanRequest): Effect.Effect<Scan, BudgetExceeded> =>
  Effect.flatMap(nodeRuntime.contextEffect, (services) =>
    Effect.provideContext(new TreeScan(request).run(), services),
  );

const firstFileSystemType = (path: string) =>
  Effect.gen(function* () {
    for (const candidate of [path, ...ancestorsOf(path)]) {
      const info = yield* Effect.promise(() => statfs(candidate).catch(() => undefined));
      if (info !== undefined) return info.type;
    }
    return undefined;
  });

export const anyUnreliable = (paths: readonly string[]): Effect.Effect<boolean> =>
  Effect.gen(function* () {
    if (process.platform !== "linux" && process.platform !== "android") return false;
    for (const path of paths) {
      const type = yield* firstFileSystemType(path);
      if (type !== undefined && UNRELIABLE_FILE_SYSTEMS.has(type)) return true;
    }
    return false;
  });
