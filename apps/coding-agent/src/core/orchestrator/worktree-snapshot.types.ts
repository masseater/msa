declare namespace worktreeSnapshotTypes {
  interface Snapshot {
    id: string;

    root: string;

    tree: string | undefined;
  }
}

export type { worktreeSnapshotTypes as default };
