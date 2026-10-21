import * as Effect from "effect/Effect";

import fsWatch from "../../utils/fs-watch.ts";
import awaitingModule from "../awaiting.ts";
import footerDataProviderHelpers from "../footer-data-provider-helpers.ts";
import type FooterDataProvider from "../footer-data-provider.ts";
import platformModule from "../platform/index.ts";
import type platformTypes from "../platform/index.types.ts";
import nodeFs from "../platform/node/fs.ts";
import type nodeFsTypes from "../platform/node/fs.types.ts";

const { dirname, join, schedule } = platformModule;
const { awaited, awaitingWith, performed } = awaitingModule;
const { unwatchFile, watchFile } = nodeFs;
const { exists, readText } = platformModule.files;
const { FS_WATCH_RETRY_DELAY_MS, closeWatcher, watchWithErrorHandler } = fsWatch;
const { resolveBranchWithGitAsync, shouldPollGitHead } = footerDataProviderHelpers;

const WATCH_DEBOUNCE_MS = 500;

export default class GitBranchWatcher {
  private readonly provider: FooterDataProvider;

  constructor(provider: FooterDataProvider) {
    this.provider = provider;
  }

  private headWatcher: nodeFsTypes.FSWatcher | null = null;

  private headWatchFilePath: string | null = null;

  private headWatchFileListener:
    | ((current: nodeFsTypes.Stats, previous: nodeFsTypes.Stats) => void)
    | null = null;

  private reftableWatcher: nodeFsTypes.FSWatcher | null = null;

  private reftableTablesListWatcher: nodeFsTypes.FSWatcher | null = null;

  private reftableTablesListPath: string | null = null;

  refreshTimer: platformTypes.Scheduled | null = null;

  private gitWatcherRetryTimer: platformTypes.Scheduled | null = null;

  private refreshInFlight = false;

  private refreshPending = false;

  private scheduleRefresh(): void {
    if (this.provider.disposed || this.refreshTimer !== null) return;
    if (this.refreshInFlight) {
      this.refreshPending = true;
      return;
    }
    this.refreshTimer = schedule(() => {
      this.refreshTimer = null;
      void Effect.runPromise(this.refreshGitBranchAsync());
    }, WATCH_DEBOUNCE_MS);
  }

  private refreshGitBranchAsync(): Effect.Effect<void> {
    return awaitingWith(function* () {
      if (this.provider.disposed) return;
      if (this.refreshInFlight) {
        this.refreshPending = true;
        return;
      }

      this.refreshInFlight = true;
      try {
        const nextBranch = yield* performed(this.resolveGitBranchAsync());
        if (this.provider.disposed) return;
        if (this.provider.cachedBranch !== undefined && this.provider.cachedBranch !== nextBranch) {
          this.provider.cachedBranch = nextBranch;
          this.provider.notifyBranchChange();
          return;
        }
        this.provider.cachedBranch = nextBranch;
      } finally {
        this.refreshInFlight = false;
        if (this.refreshPending && !this.provider.disposed) {
          this.refreshPending = false;
          this.scheduleRefresh();
        }
      }
    }, this);
  }

  resolveBranch(): Promise<string | null> {
    return Effect.runPromise(this.resolveGitBranchAsync());
  }

  private resolveGitBranchAsync(): Effect.Effect<string | null> {
    return awaitingWith(function* () {
      try {
        if (this.provider.gitPaths === undefined || this.provider.gitPaths === null) return null;
        const content = (yield* awaited(readText(this.provider.gitPaths.headPath))).trim();
        if (content.startsWith("ref: refs/heads/")) {
          const branch = content.slice(16);
          return branch === ".invalid"
            ? ((yield* awaited(resolveBranchWithGitAsync(this.provider.gitPaths.repoDir))) ??
                "detached")
            : branch;
        }
        return "detached";
      } catch {
        return null;
      }
    }, this);
  }

  clearGitWatchers(): void {
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
    if (this.provider.disposed || this.gitWatcherRetryTimer !== null) {
      return;
    }

    this.gitWatcherRetryTimer = schedule(() => {
      this.gitWatcherRetryTimer = null;
      void this.setupGitWatcher();
    }, FS_WATCH_RETRY_DELAY_MS);
  }

  private handleGitWatcherError(): void {
    this.clearGitWatchers();
    this.scheduleGitWatcherRetry();
  }

  setupGitWatcher(): Promise<void> {
    this.clearGitWatchers();
    if (this.provider.gitPaths === undefined || this.provider.gitPaths === null) {
      return Promise.resolve();
    }

    const pollGitHead = shouldPollGitHead(this.provider.gitPaths.repoDir);

    this.headWatcher = watchWithErrorHandler(
      dirname(this.provider.gitPaths.headPath),
      (_eventType, filename) => {
        if (filename === null || filename === "" || filename === "HEAD") {
          this.scheduleRefresh();
        }
      },
      () => this.handleGitWatcherError(),
    );
    if (pollGitHead) {
      this.headWatchFilePath = this.provider.gitPaths.headPath;
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
      return Promise.resolve();
    }
    return this.setupReftableWatchers(join(this.provider.gitPaths.commonGitDir, "reftable"));
  }

  private setupReftableWatchers(reftableDir: string): Promise<void> {
    const tablesListPath = join(reftableDir, "tables.list");
    return Promise.all([exists(reftableDir), exists(tablesListPath)]).then(
      ([hasReftable, hasTablesList]) => {
        if (!hasReftable || this.provider.disposed) return undefined;
        this.watchReftableDir(reftableDir);
        if (this.reftableWatcher === null || !hasTablesList) return undefined;
        this.watchTablesList(tablesListPath);
        if (this.reftableTablesListWatcher !== null) this.pollTablesList(tablesListPath);
        return undefined;
      },
    );
  }

  private watchReftableDir(reftableDir: string) {
    this.reftableWatcher = watchWithErrorHandler(
      reftableDir,
      () => {
        this.scheduleRefresh();
      },
      () => this.handleGitWatcherError(),
    );
  }

  private watchTablesList(tablesListPath: string) {
    this.reftableTablesListPath = tablesListPath;
    this.reftableTablesListWatcher = watchWithErrorHandler(
      tablesListPath,
      () => {
        this.scheduleRefresh();
      },
      () => this.handleGitWatcherError(),
    );
  }

  private pollTablesList(tablesListPath: string) {
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
