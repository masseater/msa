import { createHash } from "node:crypto";
import { type FSWatcher, watch as fsWatch, type Stats } from "node:fs";
import { lstat, readdir, readFile, stat, statfs } from "node:fs/promises";
import { dirname, relative, sep } from "node:path";

import type { Context } from "@msa/chord";

import { FileError, type FileWatcher, type WatchChange, type WatchTarget } from "./index.ts";

export interface NodeWatchOptions {
  mode?: "native" | "polling";
  pollIntervalMs?: number;
  maxDirectories?: number;
}

type ResolvedTarget = {
  readonly path: string;
  readonly recursive: boolean;
  readonly hidden: boolean;
  readonly names: ReadonlySet<string>;
};

type Entry = {
  readonly kind: "file" | "directory" | "symlink" | "other";
  readonly dev: number;
  readonly ino: number;
  readonly size: number;
  readonly mtimeMs: number;
  readonly hash?: string;
};

type Snapshot = Map<string, Entry>;

type Installed = { readonly watcher: FSWatcher; readonly dev: number; readonly ino: number };

type Scan = { readonly snapshot: Snapshot; readonly linkedFiles: ReadonlySet<string> };

const DEBOUNCE_MS = 50;
const FSEVENTS_SETTLE_MS = 500;
const DEFAULT_POLL_MS = 2000;
const DEFAULT_MAX_DIRECTORIES = 10_000;
const HASH_MAX_BYTES = 256 * 1024;
const HASH_RECENT_MS = 5000;

const UNRELIABLE_FILE_SYSTEMS = new Set([
  0x6969, 0x517b, 0xff534d42, 0xfe534d42, 0x65735546, 0x01021997, 0x0bd00bd0, 0x47504653,
  0x00c36400, 0x5346414f, 0x6b414653, 0x5dca2df5,
]);

class BudgetExceeded extends Error {}

function isNodeError(error: unknown): error is NodeJS.ErrnoException {
  return error instanceof Error && "code" in error;
}

function isDenied(error: unknown): boolean {
  return isNodeError(error) && (error.code === "EACCES" || error.code === "EPERM");
}

function entryOf(stats: Stats, hash?: string): Entry {
  const kind = stats.isFile()
    ? "file"
    : stats.isDirectory()
      ? "directory"
      : stats.isSymbolicLink()
        ? "symlink"
        : "other";
  return {
    kind,
    dev: stats.dev,
    ino: stats.ino,
    size: kind === "directory" ? 0 : stats.size,
    mtimeMs: kind === "directory" ? 0 : stats.mtimeMs,
    ...(hash === undefined ? {} : { hash }),
  };
}

function sameEntry(a: Entry, b: Entry): boolean {
  return (
    a.kind === b.kind &&
    a.dev === b.dev &&
    a.ino === b.ino &&
    a.size === b.size &&
    a.mtimeMs === b.mtimeMs &&
    a.hash === b.hash
  );
}

function ancestorsOf(path: string): string[] {
  const result: string[] = [];
  for (let current = dirname(path); ; current = dirname(current)) {
    result.push(current);
    if (dirname(current) === current) return result;
  }
}

function isWithin(path: string, ancestor: string): boolean {
  return path === ancestor || path.startsWith(ancestor.endsWith(sep) ? ancestor : ancestor + sep);
}

function excluded(target: ResolvedTarget, name: string): boolean {
  return (target.hidden && name.startsWith(".")) || target.names.has(name);
}

export class NodeFileWatcher implements FileWatcher {
  readonly #targets: readonly ResolvedTarget[];
  readonly #onChange: (change: WatchChange) => void;
  readonly #pollIntervalMs: number;
  readonly #maxDirectories: number;
  readonly #watchers = new Map<string, Installed>();
  readonly #events = new Set<string>();
  #mode: "native" | "polling";
  #snapshot: Snapshot = new Map();
  #timer: ReturnType<typeof setTimeout> | undefined;
  #settleTimer: ReturnType<typeof setTimeout> | undefined;
  #running: Promise<void> | undefined;
  #dirty = false;
  #closed = false;

  private constructor(
    targets: readonly ResolvedTarget[],
    onChange: (change: WatchChange) => void,
    mode: "native" | "polling",
    options: NodeWatchOptions,
  ) {
    this.#targets = targets;
    this.#onChange = onChange;
    this.#mode = mode;
    this.#pollIntervalMs = options.pollIntervalMs ?? DEFAULT_POLL_MS;
    this.#maxDirectories = options.maxDirectories ?? DEFAULT_MAX_DIRECTORIES;
  }

  static async open(
    targets: readonly WatchTarget[],
    resolvePath: (path: string) => string,
    onChange: (change: WatchChange) => void,
    options: NodeWatchOptions,
  ): Promise<NodeFileWatcher> {
    const resolved = targets.map((target) => ({
      path: resolvePath(target.path),
      recursive: target.recursive === true,
      hidden: target.exclude?.hidden === true,
      names: new Set(target.exclude?.names ?? []),
    }));
    const mode =
      options.mode ??
      (process.platform === "win32" || (await anyUnreliable(resolved.map((target) => target.path)))
        ? "polling"
        : "native");
    const watcher = new NodeFileWatcher(resolved, onChange, mode, options);
    try {
      await watcher.#sync(false);
    } catch (error) {
      watcher.#stop();
      if (error instanceof BudgetExceeded) throw new FileError("invalid", error.message);
      throw error;
    }
    watcher.#schedulePoll();
    return watcher;
  }

  get mode(): "native" | "polling" {
    return this.#mode;
  }

  async close(_context: Context): Promise<void> {
    if (this.#closed) return;
    this.#stop();
    await this.#running;
  }

  #stop(): void {
    this.#closed = true;
    clearTimeout(this.#timer);
    this.#timer = undefined;
    clearTimeout(this.#settleTimer);
    this.#settleTimer = undefined;
    for (const { watcher } of this.#watchers.values()) watcher.close();
    this.#watchers.clear();
  }

  #deliver(change: WatchChange): void {
    if (this.#closed) return;
    try {
      this.#onChange(change);
    } catch {}
  }

  #schedulePoll(): void {
    if (this.#closed || this.#mode !== "polling") return;
    this.#timer = setTimeout(() => {
      this.#timer = undefined;
      void this.#flush().finally(() => this.#schedulePoll());
    }, this.#pollIntervalMs);
  }

  #scheduleFlush(): void {
    if (this.#closed || this.#timer !== undefined) return;
    this.#timer = setTimeout(() => {
      this.#timer = undefined;
      void this.#flush();
    }, DEBOUNCE_MS);
  }

  #scheduleSettle(): void {
    if (this.#closed) return;
    clearTimeout(this.#settleTimer);
    this.#settleTimer = setTimeout(() => {
      this.#settleTimer = undefined;
      void this.#flush();
    }, FSEVENTS_SETTLE_MS);
  }

  #flush(): Promise<void> {
    if (this.#running !== undefined) {
      this.#dirty = true;
      return this.#running;
    }
    this.#running = (async () => {
      try {
        await this.#flushRound();
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        const fileError =
          error instanceof FileError
            ? error
            : new FileError(isDenied(error) ? "permission_denied" : "invalid", message);
        this.#deliver({ error: fileError });
        this.#stop();
      } finally {
        this.#running = undefined;
      }
    })();
    return this.#running;
  }

  async #flushRound(): Promise<void> {
    this.#dirty = false;
    const events = [...this.#events];
    this.#events.clear();
    const changed = await this.#sync(true);
    for (const path of events) changed.add(path);
    if (changed.size > 0) this.#deliver({ paths: [...changed].sort() });
    if (this.#dirty && !this.#closed) await this.#flushRound();
  }

  async #sync(report: boolean): Promise<Set<string>> {
    const changed = new Set<string>();
    await this.#syncRound(0, report, changed);
    return changed;
  }

  async #syncRound(round: number, report: boolean, changed: Set<string>): Promise<void> {
    if (round >= 10 || this.#closed) return;
    const scan = await this.#scan();
    if (this.#closed) return;
    const next = scan.snapshot;
    if (report) for (const path of this.#diff(this.#snapshot, next)) changed.add(path);
    this.#snapshot = next;
    if (this.#mode === "polling" || !this.#reconcileWatchers(scan)) return;
    if (process.platform === "darwin") this.#scheduleSettle();
    await this.#syncRound(round + 1, true, changed);
  }

  #diff(previous: Snapshot, next: Snapshot): string[] {
    const changed: string[] = [];
    for (const [path, entry] of next) {
      const before = previous.get(path);
      if (before === undefined || !sameEntry(before, entry)) changed.push(this.#reported(path));
    }
    for (const path of previous.keys()) if (!next.has(path)) changed.push(this.#reported(path));
    return changed;
  }

  #reported(path: string): string {
    if (this.#targets.some((target) => isWithin(path, target.path))) return path;
    return this.#targets.find((target) => isWithin(target.path, path))?.path ?? path;
  }

  async #scan(): Promise<Scan> {
    const snapshot: Snapshot = new Map();
    const linkedFiles = new Set<string>();
    const counted = new Set<string>();
    const traversed = new Set<string>();
    const listed = new Map<string, Entry["kind"]>();
    const countDirectory = (path: string): void => {
      counted.add(path);
      if (counted.size > this.#maxDirectories) {
        throw new BudgetExceeded(`Watched paths exceed ${this.#maxDirectories} directories`);
      }
    };
    const record = async (path: string, stats: Stats): Promise<void> => {
      let hash: string | undefined;
      if (
        this.#mode === "polling" &&
        stats.isFile() &&
        stats.size <= HASH_MAX_BYTES &&
        Date.now() - stats.mtimeMs < HASH_RECENT_MS
      ) {
        hash = await readFile(path).then(
          (content) => createHash("sha256").update(content).digest("hex"),
          () => undefined,
        );
      }
      snapshot.set(path, entryOf(stats, hash));
    };
    const scanDirectory = async (
      index: number,
      target: ResolvedTarget,
      directory: string,
    ): Promise<void> => {
      const key = `${index}\0${directory}`;
      if (traversed.has(key)) return;
      traversed.add(key);
      let names: string[];
      try {
        names = await readdir(directory);
      } catch (error) {
        if (directory === target.path && isDenied(error)) throw error;
        if (
          isNodeError(error) &&
          ["ENOENT", "EACCES", "EPERM", "ENOTDIR"].includes(error.code ?? "")
        )
          return;
        throw error;
      }
      for await (const name of names) {
        if (excluded(target, name)) continue;
        const path = `${directory.endsWith(sep) ? directory : directory + sep}${name}`;
        let kind = listed.get(path);
        if (kind === undefined) {
          const stats = await lstat(path).catch(() => undefined);
          if (stats === undefined) continue;
          kind = entryOf(stats).kind;
          listed.set(path, kind);
          if (!snapshot.has(path)) await record(path, stats);
        }
        if (target.recursive && kind === "directory") {
          countDirectory(path);
          await scanDirectory(index, target, path);
        }
      }
    };
    for await (const [index, target] of this.#targets.entries()) {
      for await (const ancestor of ancestorsOf(target.path)) {
        if (snapshot.has(ancestor)) continue;
        const stats = await lstat(ancestor).catch(() => undefined);
        if (stats !== undefined) snapshot.set(ancestor, { ...entryOf(stats), size: 0, mtimeMs: 0 });
      }
      let stats: Stats;
      try {
        stats = await stat(target.path);
      } catch (error) {
        if (isDenied(error)) throw error;
        continue;
      }
      await record(target.path, stats);
      if (stats.isFile() && (await lstat(target.path).catch(() => undefined))?.isSymbolicLink()) {
        linkedFiles.add(target.path);
      }
      if (stats.isDirectory()) {
        countDirectory(target.path);
        await scanDirectory(index, target, target.path);
      }
    }
    return { snapshot, linkedFiles };
  }

  #reconcileWatchers({ snapshot, linkedFiles }: Scan): boolean {
    const wanted = new Map<string, boolean>();
    for (const path of linkedFiles) wanted.set(path, false);
    const perDirectory = process.platform === "linux" || process.platform === "android";
    for (const target of this.#targets) {
      for (const ancestor of ancestorsOf(target.path)) {
        if (snapshot.get(ancestor)?.kind === "directory" && !wanted.has(ancestor))
          wanted.set(ancestor, false);
      }
      if (snapshot.get(target.path)?.kind !== "directory") continue;
      const recursiveRoot = target.recursive && !perDirectory;
      wanted.set(target.path, recursiveRoot);
      if (target.recursive && perDirectory) {
        for (const [path, entry] of snapshot) {
          if (entry.kind === "directory" && path !== target.path && isWithin(path, target.path)) {
            wanted.set(path, false);
          }
        }
      }
    }
    for (const [path, installed] of this.#watchers) {
      const entry = snapshot.get(path);
      if (
        !wanted.has(path) ||
        entry === undefined ||
        entry.dev !== installed.dev ||
        entry.ino !== installed.ino
      ) {
        installed.watcher.close();
        this.#watchers.delete(path);
      }
    }
    let added = false;
    for (const [path, recursive] of wanted) {
      const entry = snapshot.get(path);
      if (this.#watchers.has(path) || entry === undefined) continue;
      const linked = linkedFiles.has(path);
      try {
        const watcher = fsWatch(path, { recursive, persistent: false }, (_event, filename) =>
          linked
            ? this.#onLinkedFileEvent(path)
            : this.#onEvent(path, filename === null ? undefined : String(filename)),
        );
        watcher.on("error", () => {
          watcher.close();
          if (this.#watchers.get(path)?.watcher === watcher) this.#watchers.delete(path);
          this.#scheduleFlush();
        });
        this.#watchers.set(path, { watcher, dev: entry.dev, ino: entry.ino });
        added = true;
      } catch (error) {
        if (
          isNodeError(error) &&
          error.code !== "ENOENT" &&
          error.code !== "EACCES" &&
          error.code !== "EPERM"
        ) {
          this.#switchToPolling();
          return false;
        }
      }
    }
    return added;
  }

  #switchToPolling(): void {
    if (this.#mode === "polling") return;
    this.#mode = "polling";
    for (const { watcher } of this.#watchers.values()) watcher.close();
    this.#watchers.clear();
    this.#deliver({ overflow: true });
    clearTimeout(this.#timer);
    this.#timer = undefined;
    this.#schedulePoll();
  }

  #onEvent(directory: string, filename: string | undefined): void {
    if (this.#closed) return;
    const path =
      filename === undefined
        ? directory
        : `${directory.endsWith(sep) ? directory : directory + sep}${filename}`;
    const relevant = this.#inScope(path);
    if (relevant) this.#events.add(this.#reported(path));
    if (relevant || filename === undefined) this.#scheduleFlush();
  }

  #onLinkedFileEvent(target: string): void {
    if (this.#closed) return;
    this.#events.add(target);
    this.#scheduleFlush();
  }

  #inScope(path: string): boolean {
    for (const target of this.#targets) {
      if (isWithin(target.path, path)) return true;
      if (!isWithin(path, target.path) || path === target.path) continue;
      const components = relative(target.path, path).split(sep);
      if (!target.recursive && components.length > 1) continue;
      if (components.some((name) => excluded(target, name))) continue;
      return true;
    }
    return false;
  }
}

async function anyUnreliable(paths: readonly string[]): Promise<boolean> {
  if (process.platform !== "linux" && process.platform !== "android") return false;
  for await (const path of paths) {
    for await (const candidate of [path, ...ancestorsOf(path)]) {
      const info = await statfs(candidate).catch(() => undefined);
      if (info === undefined) continue;
      if (UNRELIABLE_FILE_SYSTEMS.has(info.type)) return true;
      break;
    }
  }
  return false;
}
