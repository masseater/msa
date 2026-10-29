declare namespace taskCommandTypes {
  type ExportTarget = string | { readonly [condition: string]: ExportTarget } | null;

  interface NodeRun {
    readonly conditions: ReadonlyArray<string>;
    readonly entries: ReadonlyArray<string>;
    readonly preloads: ReadonlyArray<string>;
  }

  type NodeFlags = ReadonlyMap<string, boolean>;

  type Parsed = NodeRun | { readonly problem: string };

  type FlagRead =
    | { readonly name: string; readonly size: number; readonly value: string }
    | { readonly problem: string };

  interface RunRef {
    readonly filters: ReadonlyArray<string>;
    readonly name: string;
    readonly recursive: boolean;
  }

  type TaskCommand = string | ReadonlyArray<string>;

  type TaskEntry = TaskCommand | { readonly command: TaskCommand };

  interface PackageEntry {
    readonly exports: Readonly<Record<string, ExportTarget>> | undefined;
    readonly main: string | undefined;
  }
}

export type { taskCommandTypes as default };
