import type typesModule from "../types.types.ts";

declare namespace diagnosticsTypes {
  interface DiagnosticErrorInfo {
    name?: string | undefined;
    message: string;
    stack?: string | undefined;
    code?: string | number | undefined;
  }

  interface AssistantMessageDiagnostic {
    type: string;
    timestamp: number;
    error?: DiagnosticErrorInfo | undefined;
    details?: typesModule.JsonObject | undefined;
  }
}

export type { diagnosticsTypes as default };
