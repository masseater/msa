declare namespace nodeWatchScopeTypes {
  type ResolvedTarget = {
    readonly path: string;
    readonly recursive: boolean;
    readonly hidden: boolean;
    readonly names: ReadonlySet<string>;
  };

  type EntryKind = "file" | "directory" | "symlink" | "other";

  type Entry = {
    readonly kind: EntryKind;
    readonly dev: number;
    readonly ino: number;
    readonly size: number;
    readonly mtimeMs: number;
    readonly hash?: string;
  };

  type Snapshot = Map<string, Entry>;

  type Scan = { readonly snapshot: Snapshot; readonly linkedFiles: ReadonlySet<string> };

  type SnapshotChange = { readonly previous: Snapshot; readonly next: Snapshot };
}

export type { nodeWatchScopeTypes as default };
