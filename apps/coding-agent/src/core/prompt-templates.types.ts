import type diagnosticsTypes from "./diagnostics.ts";
import type sourceInfoTypes from "./source-info.types.ts";

declare namespace promptTemplatesTypes {
  interface PromptTemplate {
    name: string;
    description: string;
    argumentHint?: string;
    content: string;
    sourceInfo: sourceInfoTypes.SourceInfo;
    filePath: string;
  }

  interface LoadPromptTemplatesOptions {
    cwd: string;
    agentDir: string;
    promptPaths: string[];
    includeDefaults: boolean;
  }

  interface LoadPromptTemplatesResult {
    templates: PromptTemplate[];
    diagnostics: diagnosticsTypes.ResourceDiagnostic[];
  }
}

export type { promptTemplatesTypes as default };
