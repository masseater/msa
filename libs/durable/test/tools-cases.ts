import type { ToolExecutionResult } from "@msa/durable";

function diagnosticText(result: ToolExecutionResult): string {
  return (result.diagnostics ?? []).map((diagnostic) => diagnostic.message).join("\n");
}

export default diagnosticText;
