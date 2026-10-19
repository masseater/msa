import type { ToolExecutionResult } from "@msa/durable";

export function diagnosticText(result: ToolExecutionResult): string {
  return (result.diagnostics ?? []).map((diagnostic) => diagnostic.message).join("\n");
}
