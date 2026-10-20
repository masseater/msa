import type agentTypes from "@msa/agent-core/index.types";
import type compatTypes from "@msa/ai/compat.types";
import type aiTypes from "@msa/ai/index.types";

import type extensionsTypesTypes from "./extensions/types.types.ts";
import type modelRuntimeTypes from "./model-runtime.types.ts";
import type settingsManagerTypes from "./settings-manager.types.ts";

declare namespace bugReportInternalTypes {
  interface CollectBugReportMetadataOptions {
    id?: string | undefined;
    hint?: string | undefined;
    sessionId: string;
    cwd: string;
    includeSession: boolean;
    includeSummary: boolean;
    messageCount: number;
    model?: compatTypes.Model<compatTypes.Api> | undefined;
    modelRuntime: modelRuntimeTypes.ModelRuntime;
    thinkingLevel: agentTypes.ThinkingLevel;
    extensions: readonly extensionsTypesTypes.Extension[];
    extensionErrors: ReadonlyArray<{ path: string; error: string }>;
    globalSettings: settingsManagerTypes.Settings;
    projectSettings: settingsManagerTypes.Settings;
  }

  interface BugReportFile {
    name: string;
    contentType: string;
    data: string;
  }

  interface GenerateBugReportSummaryOptions {
    messages: readonly agentTypes.AgentMessage[];
    hint?: string | undefined;
    model: compatTypes.Model<compatTypes.Api>;
    apiKey?: string | undefined;
    headers?: Record<string, string> | undefined;
    env?: Record<string, string> | undefined;
    signal: AbortSignal;
    thinkingLevel?: agentTypes.ThinkingLevel;
    streamFn?: agentTypes.StreamFn;
    retry?: aiTypes.RetryPolicy;
    sessionId?: string;
  }
}

export type { bugReportInternalTypes as default };
