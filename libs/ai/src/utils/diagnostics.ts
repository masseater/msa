import { Clock, Effect, Function } from "effect";

import type typesModule from "../types.types.ts";
import type diagnosticsTypes from "./diagnostics.types.ts";

function formatThrownValue(value: unknown): string {
  if (value instanceof Error) return value.message || value.name;
  if (typeof value === "string") return value;
  return String(value);
}

function extractDiagnosticError(error: unknown): diagnosticsTypes.DiagnosticErrorInfo {
  if (!(error instanceof Error)) return { message: formatThrownValue(error), name: "ThrownValue" };
  const code = (error as Error & { code?: unknown }).code;
  return {
    code: typeof code === "string" || typeof code === "number" ? code : undefined,
    message: error.message || error.name,
    name: error.name || undefined,
    stack: error.stack,
  };
}

const createAssistantMessageDiagnostic: {
  (
    error: unknown,
    details: typesModule.JsonObject | undefined,
  ): (type: string) => diagnosticsTypes.AssistantMessageDiagnostic;
  (
    type: string,
    error: unknown,
    details: typesModule.JsonObject | undefined,
  ): diagnosticsTypes.AssistantMessageDiagnostic;
} = Function.dual(
  3,
  function (
    type: string,
    error: unknown,
    details: typesModule.JsonObject | undefined,
  ): diagnosticsTypes.AssistantMessageDiagnostic {
    return {
      details,
      error: extractDiagnosticError(error),
      timestamp: Effect.runSync(Clock.currentTimeMillis),
      type,
    };
  },
);

const appendAssistantMessageDiagnostic: {
  <T extends { diagnostics?: diagnosticsTypes.AssistantMessageDiagnostic[] }>(
    diagnostic: diagnosticsTypes.AssistantMessageDiagnostic,
  ): (message: T) => void;
  <T extends { diagnostics?: diagnosticsTypes.AssistantMessageDiagnostic[] }>(
    message: T,
    diagnostic: diagnosticsTypes.AssistantMessageDiagnostic,
  ): void;
} = Function.dual(2, function <
  T extends { diagnostics?: diagnosticsTypes.AssistantMessageDiagnostic[] },
>(message: T, diagnostic: diagnosticsTypes.AssistantMessageDiagnostic): void {
  message.diagnostics = [...(message.diagnostics ?? []), diagnostic];
});

const diagnosticsModule = {
  appendAssistantMessageDiagnostic,
  createAssistantMessageDiagnostic,
  extractDiagnosticError,
  formatThrownValue,
};

export default diagnosticsModule;
