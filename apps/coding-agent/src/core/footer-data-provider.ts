import footerDataProviderSupport from "./footer-data-provider-support.ts";
import type footerDataProviderTypes from "./footer-data-provider.types.ts";
import GitBranchWatcher from "./footer-data-provider/git-branch-watcher.ts";

const { findGitPaths } = footerDataProviderSupport;

export default class FooterDataProvider {
  readonly gitWatch: GitBranchWatcher;

  private cwd!: string;

  private extensionStatuses = new Map<string, string>();

  cachedBranch: string | null | undefined = undefined;

  gitPaths: footerDataProviderTypes.GitPaths | null | undefined = undefined;

  private branchChangeCallbacks = new Set<() => void>();

  private availableProviderCount = 0;

  disposed = false;

  getGitBranch(): string | null {
    if (this.cachedBranch === undefined) {
      this.cachedBranch = this.gitWatch.resolveGitBranchSync();
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
    if (this.gitWatch.refreshTimer !== null) {
      this.gitWatch.refreshTimer.cancel();
      this.gitWatch.refreshTimer = null;
    }
    this.gitWatch.clearGitWatchers();
    this.branchChangeCallbacks.clear();
  }

  notifyBranchChange(): void {
    for (const cb of this.branchChangeCallbacks) cb();
  }

  setCwd(cwd: string): void {
    if (this.cwd === cwd) {
      return;
    }

    this.cwd = cwd;
    if (this.gitWatch.refreshTimer !== null) {
      this.gitWatch.refreshTimer.cancel();
      this.gitWatch.refreshTimer = null;
    }
    this.gitWatch.clearGitWatchers();
    this.cachedBranch = undefined;
    this.gitPaths = findGitPaths(cwd);
    this.gitWatch.setupGitWatcher();
    this.notifyBranchChange();
  }

  constructor(cwd: string) {
    this.gitWatch = new GitBranchWatcher(this);
    this.cwd = cwd;
    this.gitPaths = findGitPaths(cwd);
    this.gitWatch.setupGitWatcher();
  }
}
