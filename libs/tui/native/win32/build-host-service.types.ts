declare namespace buildHostServiceTypes {
  interface CommandRun {
    readonly command: string;
    readonly args: ReadonlyArray<string>;
    readonly cwd?: string | undefined;
    readonly stdio: "inherit" | "ignore";
  }
}

export type { buildHostServiceTypes as default };
