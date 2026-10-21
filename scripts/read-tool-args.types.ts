import type readToolArgs from "./read-tool-args.ts";

declare namespace readToolArgsTypes {
  interface Args {
    allSessions: boolean;
    autoSincePath: string | undefined;
    bucket: "day" | "week";
    includeRecords: boolean;
    json: boolean;
    modelFilter: string | undefined;
    sessionsDir: string;
    since: string | undefined;
    text: boolean;
    top: number;
  }

  type ReadToolStatsError = (typeof readToolArgs.ReadToolStatsError)["prototype"];
}

export type { readToolArgsTypes as default };
