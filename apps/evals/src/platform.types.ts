declare namespace platformTypes {
  type PathOperations = {
    readonly join: (...segments: ReadonlyArray<string>) => string;
    readonly dirname: (path: string) => string;
    readonly resolve: (...segments: ReadonlyArray<string>) => string;
    readonly relative: (from: string, to: string) => string;
    readonly isAbsolute: (path: string) => boolean;
    readonly basename: (path: string, suffix?: string) => string;
    readonly separator: string;
  };

  type EntryKind = "directory" | "file" | "symlink" | "other";

  type ReadProbe = "readable" | "unreadable";

  type CommandResult = { readonly status: number; readonly stdout: string };

  type CommandOutputMode = "inherit" | "capture" | "ignore";
}

export type { platformTypes as default };
