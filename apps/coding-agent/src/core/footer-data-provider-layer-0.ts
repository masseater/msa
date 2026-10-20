import type footerDataProviderTypes from "./footer-data-provider.types.ts";
import type platformTypes from "./platform.types.ts";
import type nodeFsTypes from "./platform/node/fs.types.ts";

export default abstract class FooterDataProviderLayer0 {
  protected cwd!: string;
  static readonly WATCH_DEBOUNCE_MS = 500;
  protected extensionStatuses = new Map<string, string>();
  protected cachedBranch: string | null | undefined = undefined;
  protected gitPaths: footerDataProviderTypes.GitPaths | null | undefined = undefined;
  protected headWatcher: nodeFsTypes.FSWatcher | null = null;
  protected headWatchFilePath: string | null = null;
  protected headWatchFileListener:
    | ((current: nodeFsTypes.Stats, previous: nodeFsTypes.Stats) => void)
    | null = null;
  protected reftableWatcher: nodeFsTypes.FSWatcher | null = null;
  protected reftableTablesListWatcher: nodeFsTypes.FSWatcher | null = null;
  protected reftableTablesListPath: string | null = null;
  protected branchChangeCallbacks = new Set<() => void>();
  protected availableProviderCount = 0;
  protected refreshTimer: platformTypes.Scheduled | null = null;
  protected gitWatcherRetryTimer: platformTypes.Scheduled | null = null;
  protected refreshInFlight = false;
  protected refreshPending = false;
  protected disposed = false;
}
