import type callRows from "./call-outcome.ts";

declare namespace callRowsTypes {
  type CodemodeNestedCall = {
    id: number;
    name: string;
    args: string;
    status: "running" | "ok" | "error" | "cancelled";
    durationMs?: number;
    error?: string;
  };

  type CodemodeToolDetails = {
    calls: CodemodeNestedCall[];
    fullOutputPath?: string;
  };

  type CallRows = (typeof callRows.CallRows)["prototype"];
}

export type { callRowsTypes as default };
