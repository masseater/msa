import { type ExecFileException, execFile, spawnSync } from "child_process";
import {
  type FSWatcher,
  type Stats,
  existsSync,
  readFileSync,
  statSync,
  unwatchFile,
  watchFile,
} from "fs";

import * as Effect from "effect/Effect";

import { FS_WATCH_RETRY_DELAY_MS, closeWatcher, watchWithErrorHandler } from "../utils/fs-watch.ts";
import { awaited, awaitingWith, performed } from "./awaiting.ts";
import { dirname, join, resolve } from "./platform-node.ts";
import { type Scheduled, schedule } from "./platform.ts";
import { readEnv } from "./process-env.ts";

export type GitPaths = {
  repoDir: string;
  commonGitDir: string;
  headPath: string;
};

export function findGitPaths(cwd: string): GitPaths | null {
  let dir = cwd;
  while (true) {
    const gitPath = join(dir, ".git");
    if (existsSync(gitPath)) {
      try {
        const stat = statSync(gitPath);
        if (stat.isFile()) {
          const content = readFileSync(gitPath, "utf8").trim();
          if (content.startsWith("gitdir: ")) {
            const gitDir = resolve(dir, content.slice(8).trim());
            const headPath = join(gitDir, "HEAD");
            if (!existsSync(headPath)) return null;
            const commonDirPath = join(gitDir, "commondir");
            const commonGitDir = existsSync(commonDirPath)
              ? resolve(gitDir, readFileSync(commonDirPath, "utf8").trim())
              : gitDir;
            return { commonGitDir, headPath, repoDir: dir };
          }
        } else if (stat.isDirectory()) {
          const headPath = join(gitPath, "HEAD");
          if (!existsSync(headPath)) return null;
          return { commonGitDir: gitPath, headPath, repoDir: dir };
        }
      } catch {
        return null;
      }
    }
    const parent = dirname(dir);
    if (parent === dir) return null;
    dir = parent;
  }
}

function resolveBranchWithGitSync(repoDir: string): string | null {
  const result = spawnSync(
    "git",
    ["--no-optional-locks", "symbolic-ref", "--quiet", "--short", "HEAD"],
    {
      cwd: repoDir,
      encoding: "utf8",
      stdio: ["ignore", "pipe", "ignore"],
    },
  );
  const branch = result.status === 0 ? result.stdout.trim() : "";
  return branch || null;
}

function resolveBranchWithGitAsync(repoDir: string): Promise<string | null> {
  return Effect.runPromise(
    Effect.callback<string | null>((resume) => {
      execFile(
        "git",
        ["--no-optional-locks", "symbolic-ref", "--quiet", "--short", "HEAD"],
        {
          cwd: repoDir,
          encoding: "utf8",
        },
        (error: ExecFileException | null, stdout: string) => {
          if (error !== null) {
            resume(Effect.succeed(null));
            return;
          }
          const branch = stdout.trim();
          resume(Effect.succeed(branch === "" ? null : branch));
        },
      );
    }),
  );
}

function isWslEnvironment(): boolean {
  return (
    process.platform === "linux" &&
    ((readEnv("WSL_DISTRO_NAME") ?? "") !== "" || (readEnv("WSL_INTEROP") ?? "") !== "")
  );
}

function isWindowsMountedRepoPath(repoDir: string): boolean {
  return /^\/mnt\/[a-z](?:\/|$)/iu.test(repoDir);
}

function shouldPollGitHead(repoDir: string): boolean {
  return isWslEnvironment() && isWindowsMountedRepoPath(repoDir);
}

export class FooterDataProvider {
  private cwd: string;
  private static readonly WATCH_DEBOUNCE_MS = 500;

  private extensionStatuses = new Map<string, string>();
  private cachedBranch: string | null | undefined = undefined;
  private gitPaths: GitPaths | null | undefined = undefined;
  private headWatcher: FSWatcher | null = null;
  private headWatchFilePath: string | null = null;
  private headWatchFileListener: ((current: Stats, previous: Stats) => void) | null = null;
  private reftableWatcher: FSWatcher | null = null;
  private reftableTablesListWatcher: FSWatcher | null = null;
  private reftableTablesListPath: string | null = null;
  private branchChangeCallbacks = new Set<() => void>();
  private availableProviderCount = 0;
  private refreshTimer: Scheduled | null = null;
  private gitWatcherRetryTimer: Scheduled | null = null;
  private refreshInFlight = false;
  private refreshPending = false;
  private disposed = false;

  constructor(cwd: string) {
    this.cwd = cwd;
    this.gitPaths = findGitPaths(cwd);
    this.setupGitWatcher();
  }

  getGitBranch(): string | null {
    if (this.cachedBranch === undefined) {
      this.cachedBranch = this.resolveGitBranchSync();
    }
    return this.cachedBranch;
  }

  getExtensionStatuses(): ReadonlyMap<string, string> {
    return this.extensionStatuses;
  }

  onBranchChange(callback: () => void): () => void {
    this.branchChangeCallbacks.add(callback);
    return () => this.branchChangeCallbacks.delete(callback);
  }

  setExtensionStatus(key: string, text: string | undefined): void {
    if (text === undefined) {
      this.extensionStatuses.delete(key);
    } else {
      this.extensionStatuses.set(key, text);
    }
  }

  clearExtensionStatuses(): void {
    this.extensionStatuses.clear();
  }

  getAvailableProviderCount(): number {
    return this.availableProviderCount;
  }

  setAvailableProviderCount(count: number): void {
    this.availableProviderCount = count;
  }

  setCwd(cwd: string): void {
    if (this.cwd === cwd) {
      return;
    }

    this.cwd = cwd;
    if (this.refreshTimer !== null) {
      this.refreshTimer.cancel();
      this.refreshTimer = null;
    }
    this.clearGitWatchers();
    this.cachedBranch = undefined;
    this.gitPaths = findGitPaths(cwd);
    this.setupGitWatcher();
    this.notifyBranchChange();
  }

  dispose(): void {
    this.disposed = true;
    if (this.refreshTimer !== null) {
      this.refreshTimer.cancel();
      this.refreshTimer = null;
    }
    this.clearGitWatchers();
    this.branchChangeCallbacks.clear();
  }

  private notifyBranchChange(): void {
    for (const cb of this.branchChangeCallbacks) cb();
  }

  private scheduleRefresh(): void {
    if (this.disposed || this.refreshTimer !== null) return;
    if (this.refreshInFlight) {
      this.refreshPending = true;
      return;
    }
    this.refreshTimer = schedule(() => {
      this.refreshTimer = null;
      void Effect.runPromise(this.refreshGitBranchAsync());
    }, FooterDataProvider.WATCH_DEBOUNCE_MS);
  }

  private refreshGitBranchAsync(): Effect.Effect<void> {
    return awaitingWith(function* () {
      if (this.disposed) return;
      if (this.refreshInFlight) {
        this.refreshPending = true;
        return;
      }

      this.refreshInFlight = true;
      try {
        const nextBranch = yield* performed(this.resolveGitBranchAsync());
        if (this.disposed) return;
        if (this.cachedBranch !== undefined && this.cachedBranch !== nextBranch) {
          this.cachedBranch = nextBranch;
          this.notifyBranchChange();
          return;
        }
        this.cachedBranch = nextBranch;
      } finally {
        this.refreshInFlight = false;
        if (this.refreshPending && !this.disposed) {
          this.refreshPending = false;
          this.scheduleRefresh();
        }
      }
    }, this);
  }

  private resolveGitBranchSync(): string | null {
    try {
      if (this.gitPaths === undefined || this.gitPaths === null) return null;
      const content = readFileSync(this.gitPaths.headPath, "utf8").trim();
      if (content.startsWith("ref: refs/heads/")) {
        const branch = content.slice(16);
        return branch === ".invalid"
          ? (resolveBranchWithGitSync(this.gitPaths.repoDir) ?? "detached")
          : branch;
      }
      return "detached";
    } catch {
      return null;
    }
  }

  private resolveGitBranchAsync(): Effect.Effect<string | null> {
    return awaitingWith(function* () {
      try {
        if (this.gitPaths === undefined || this.gitPaths === null) return null;
        const content = readFileSync(this.gitPaths.headPath, "utf8").trim();
        if (content.startsWith("ref: refs/heads/")) {
          const branch = content.slice(16);
          return branch === ".invalid"
            ? ((yield* awaited(resolveBranchWithGitAsync(this.gitPaths.repoDir))) ?? "detached")
            : branch;
        }
        return "detached";
      } catch {
        return null;
      }
    }, this);
  }

  private clearGitWatchers(): void {
    closeWatcher(this.headWatcher);
    this.headWatcher = null;
    if (
      this.headWatchFilePath !== null &&
      this.headWatchFilePath !== "" &&
      this.headWatchFileListener !== null
    ) {
      unwatchFile(this.headWatchFilePath, this.headWatchFileListener);
      this.headWatchFilePath = null;
      this.headWatchFileListener = null;
    }
    closeWatcher(this.reftableWatcher);
    this.reftableWatcher = null;
    closeWatcher(this.reftableTablesListWatcher);
    this.reftableTablesListWatcher = null;
    if (this.reftableTablesListPath !== null && this.reftableTablesListPath !== "") {
      unwatchFile(this.reftableTablesListPath);
      this.reftableTablesListPath = null;
    }
    if (this.gitWatcherRetryTimer !== null) {
      this.gitWatcherRetryTimer.cancel();
      this.gitWatcherRetryTimer = null;
    }
  }

  private scheduleGitWatcherRetry(): void {
    if (this.disposed || this.gitWatcherRetryTimer !== null) {
      return;
    }

    this.gitWatcherRetryTimer = schedule(() => {
      this.gitWatcherRetryTimer = null;
      this.setupGitWatcher();
    }, FS_WATCH_RETRY_DELAY_MS);
  }

  private handleGitWatcherError(): void {
    this.clearGitWatchers();
    this.scheduleGitWatcherRetry();
  }

  private setupGitWatcher(): void {
    this.clearGitWatchers();
    if (this.gitPaths === undefined || this.gitPaths === null) return;

    const pollGitHead = shouldPollGitHead(this.gitPaths.repoDir);

    this.headWatcher = watchWithErrorHandler(
      dirname(this.gitPaths.headPath),
      (_eventType, filename) => {
        if (filename === null || filename === "" || filename === "HEAD") {
          this.scheduleRefresh();
        }
      },
      () => this.handleGitWatcherError(),
    );
    if (pollGitHead) {
      this.headWatchFilePath = this.gitPaths.headPath;
      this.headWatchFileListener = (current, previous) => {
        if (
          current.mtimeMs !== previous.mtimeMs ||
          current.ctimeMs !== previous.ctimeMs ||
          current.size !== previous.size
        ) {
          this.scheduleRefresh();
        }
      };
      watchFile(this.headWatchFilePath, { interval: 1000 }, this.headWatchFileListener);
    }
    if (this.headWatcher === null && !pollGitHead) {
      return;
    }

    const reftableDir = join(this.gitPaths.commonGitDir, "reftable");
    if (existsSync(reftableDir)) {
      this.reftableWatcher = watchWithErrorHandler(
        reftableDir,
        () => {
          this.scheduleRefresh();
        },
        () => this.handleGitWatcherError(),
      );
      if (this.reftableWatcher === null) {
        return;
      }

      const tablesListPath = join(reftableDir, "tables.list");
      if (existsSync(tablesListPath)) {
        this.reftableTablesListPath = tablesListPath;
        this.reftableTablesListWatcher = watchWithErrorHandler(
          tablesListPath,
          () => {
            this.scheduleRefresh();
          },
          () => this.handleGitWatcherError(),
        );
        if (this.reftableTablesListWatcher === null) {
          return;
        }
        watchFile(tablesListPath, { interval: 250 }, (current, previous) => {
          if (
            current.mtimeMs !== previous.mtimeMs ||
            current.ctimeMs !== previous.ctimeMs ||
            current.size !== previous.size
          ) {
            this.scheduleRefresh();
          }
        });
      }
    }
  }
}

export type ReadonlyFooterDataProvider = Pick<
  FooterDataProvider,
  "getGitBranch" | "getExtensionStatuses" | "getAvailableProviderCount" | "onBranchChange"
>;
