import type durableTypes from "@msa/durable/index.types";

function diagnosticText(result: durableTypes.ToolExecutionResult): string {
  return (result.diagnostics ?? []).map((diagnostic) => diagnostic.message).join("\n");
}

export default diagnosticText;
