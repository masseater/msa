import * as Effect from "effect/Effect";

import fsWatch from "../utils/fs-watch.ts";
import awaitingModule from "./awaiting.ts";
import footerDataProviderHelpers from "./footer-data-provider-helpers.ts";
import FooterDataProviderLayer0 from "./footer-data-provider-layer-0.ts";
import FooterDataProvider from "./footer-data-provider.ts";
import platformNode from "./platform-node.ts";
import platformModule from "./platform.ts";
import nodeFs from "./platform/node/fs.ts";

const { schedule } = platformModule;
const { awaited, awaitingWith, performed } = awaitingModule;
const { existsSync, readFileSync, unwatchFile, watchFile } = nodeFs;
const { FS_WATCH_RETRY_DELAY_MS, closeWatcher, watchWithErrorHandler } = fsWatch;
const { dirname, join } = platformNode;
const { resolveBranchWithGitAsync, resolveBranchWithGitSync, shouldPollGitHead } =
  footerDataProviderHelpers;

export default abstract class FooterDataProviderLayer1 extends FooterDataProviderLayer0 {
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

  dispose(): void {
    this.disposed = true;
    if (this.refreshTimer !== null) {
      this.refreshTimer.cancel();
      this.refreshTimer = null;
    }
    this.clearGitWatchers();
    this.branchChangeCallbacks.clear();
  }

  protected notifyBranchChange(): void {
    for (const cb of this.branchChangeCallbacks) cb();
  }

  protected scheduleRefresh(): void {
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

  protected refreshGitBranchAsync(): Effect.Effect<void> {
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

  protected resolveGitBranchSync(): string | null {
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

  protected resolveGitBranchAsync(): Effect.Effect<string | null> {
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

  protected clearGitWatchers(): void {
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

  protected scheduleGitWatcherRetry(): void {
    if (this.disposed || this.gitWatcherRetryTimer !== null) {
      return;
    }

    this.gitWatcherRetryTimer = schedule(() => {
      this.gitWatcherRetryTimer = null;
      this.setupGitWatcher();
    }, FS_WATCH_RETRY_DELAY_MS);
  }

  protected handleGitWatcherError(): void {
    this.clearGitWatchers();
    this.scheduleGitWatcherRetry();
  }

  protected setupGitWatcher(): void {
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
      this.setupGitWatcherPart3(reftableDir);
      if (this.reftableWatcher === null) {
        return;
      }

      const tablesListPath = join(reftableDir, "tables.list");
      if (existsSync(tablesListPath)) {
        this.setupGitWatcherPart2(tablesListPath);
        if (this.reftableTablesListWatcher === null) {
          return;
        }
        this.setupGitWatcherPart1(tablesListPath);
      }
    }
  }

  protected setupGitWatcherPart3(reftableDir: string) {
    this.reftableWatcher = watchWithErrorHandler(
      reftableDir,
      () => {
        this.scheduleRefresh();
      },
      () => this.handleGitWatcherError(),
    );
  }

  protected setupGitWatcherPart2(tablesListPath: string) {
    this.reftableTablesListPath = tablesListPath;
    this.reftableTablesListWatcher = watchWithErrorHandler(
      tablesListPath,
      () => {
        this.scheduleRefresh();
      },
      () => this.handleGitWatcherError(),
    );
  }

  protected setupGitWatcherPart1(tablesListPath: string) {
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
