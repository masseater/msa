import type { JsonObject } from "../types.ts";
import { currentTimeMillis } from "./clock.ts";

export interface DiagnosticErrorInfo {
  name?: string | undefined;
  message: string;
  stack?: string | undefined;
  code?: string | number | undefined;
}

export interface AssistantMessageDiagnostic {
  type: string;
  timestamp: number;
  error?: DiagnosticErrorInfo | undefined;
  details?: JsonObject | undefined;
}

export function formatThrownValue(value: unknown): string {
  if (value instanceof Error) return value.message || value.name;
  if (typeof value === "string") return value;
  return String(value);
}

export function extractDiagnosticError(error: unknown): DiagnosticErrorInfo {
  if (!(error instanceof Error)) return { name: "ThrownValue", message: formatThrownValue(error) };
  const code = (error as Error & { code?: unknown }).code;
  return {
    name: error.name || undefined,
    message: error.message || error.name,
    stack: error.stack,
    code: typeof code === "string" || typeof code === "number" ? code : undefined,
  };
}

export function createAssistantMessageDiagnostic(
  type: string,
  error: unknown,
  details?: JsonObject,
): AssistantMessageDiagnostic {
  return { type, timestamp: currentTimeMillis(), error: extractDiagnosticError(error), details };
}

export function appendAssistantMessageDiagnostic<
  T extends { diagnostics?: AssistantMessageDiagnostic[] },
>(message: T, diagnostic: AssistantMessageDiagnostic): void {
  message.diagnostics = [...(message.diagnostics ?? []), diagnostic];
}
