import type { Context, JsonValue } from "@msa/chord";
import type { CodemodeOutcome, CodemodeSandboxBase } from "@msa/codemode/portable";

import type typesModule from "../harness/types.types.ts";
import type describeTypes from "./describe.types.ts";

declare namespace runDocsTypes {
  type CodemodeGlobal = {
    readonly name: string;
    readonly spread?: boolean;
    execute(
      args: unknown,
      api: typesModule.ToolExecutionApi,
      context: Context,
    ): Promise<JsonValue | undefined>;
  };

  type CodemodeToolOptions = {
    readonly sandbox: CodemodeSandboxBase;
    readonly namespaces?: readonly describeTypes.CodemodeNamespace[];
    readonly inlineBudget?: number;
    readonly models?: boolean;
    readonly globals?: readonly CodemodeGlobal[];
  };

  type DeclaredTool = {
    name: string;
    jsName: string;
    description: string;
    structured?: true;
    hidden?: true;
  };

  type Start = {
    version: number;
    startedAt: number;
    seed: number;
    fingerprint?: string;
    deadline?: number;
    tools: DeclaredTool[];
    namespaces: { name: string; description?: string; instructions?: string; tools: string[] }[];
    globals: { name: string; spread: boolean }[];
    maxOutputTokens: number;
    store: Record<string, JsonValue>;
  };

  type JournalEntry = {
    id: number;
    at: number;
    issuedAfter?: number;
    global?: { name: string; args?: JsonValue; outcome: typesModule.JsonObject };
  };

  type Settled = {
    readonly id: number;
    readonly at: number;
    readonly outcome: CodemodeOutcome;
    readonly global?: JournalEntry["global"];
  };
}

export type { runDocsTypes as default };
