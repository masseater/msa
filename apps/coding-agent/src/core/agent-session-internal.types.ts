import type compatTypes from "@msa/ai/compat.types";

import type compactionTypes from "./compaction/index.types.ts";
import type extensionsTypes from "./extensions/index.types.ts";
import type sessionManagerTypes from "./session-manager.types.ts";
import type sourceInfoTypes from "./source-info.types.ts";

declare namespace agentSessionInternalTypes {
  interface ToolDefinitionEntry {
    definition: extensionsTypes.ToolDefinition;
    sourceInfo: sourceInfoTypes.SourceInfo;
  }

  interface CompactionOutcome {
    fromExtension: boolean;
    cancelledByExtension: boolean;
  }

  interface TreeInstructions {
    customInstructions: string | undefined;
    replaceInstructions: boolean | undefined;
    label: string | undefined;
  }

  interface TreeSummary {
    text: string | undefined;
    details: unknown;
    usage: compatTypes.Usage | undefined;
    fromExtension: boolean;
  }

  interface CompactionRun {
    readonly manual: boolean;
    readonly model: compatTypes.Model<any>;
    readonly preparation: compactionTypes.CompactionPreparation;
    readonly pathEntries: sessionManagerTypes.SessionEntry[];
    readonly reason: "manual" | "overflow" | "threshold";
    readonly signal: AbortSignal;
    readonly willRetry: boolean;
    readonly customInstructions: string | undefined;
    readonly outcome: CompactionOutcome;
  }
}

export type { agentSessionInternalTypes as default };
