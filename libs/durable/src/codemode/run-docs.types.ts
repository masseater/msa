import type chordTypes from "@msa/chord/index.types";
import type portableTypes from "@msa/codemode/portable.types";

import type typesModule from "../harness/types.types.ts";
import type describeTypes from "./describe.types.ts";

declare namespace runDocsTypes {
  type CodemodeGlobal = {
    readonly name: string;
    readonly spread?: boolean;
    execute(
      args: unknown,
      api: typesModule.ToolExecutionApi,
      context: chordTypes.Context,
    ): Promise<chordTypes.JsonValue | undefined>;
  };

  type CodemodeToolOptions = {
    readonly sandbox: portableTypes.CodemodeSandboxBase;
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
    store: Record<string, chordTypes.JsonValue>;
  };

  type JournalEntry = {
    id: number;
    at: number;
    issuedAfter?: number;
    global?: { name: string; args?: chordTypes.JsonValue; outcome: typesModule.JsonObject };
  };

  type Settled = {
    readonly id: number;
    readonly at: number;
    readonly outcome: portableTypes.CodemodeOutcome;
    readonly global?: JournalEntry["global"];
  };
}

export type { runDocsTypes as default };
