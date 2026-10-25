import type orchestratorTypesTypes from "./types.types.ts";

type Reason = orchestratorTypesTypes.ProviderWait["reason"];

const REASON_LABEL: Record<Reason, string> = {
  auth: "provider rejected the credentials",
  quota: "provider limit",
};

function firstLine(text: string): string {
  return (text.split("\n").find((line) => line.trim() !== "") ?? text).trim();
}

function cause(reason: Reason, error: string): string {
  return `${REASON_LABEL[reason]} (${firstLine(error)})`;
}

function stallKey(reason: Reason, error: string): string {
  return `provider ${reason}: ${firstLine(error)}`;
}

function stallText(reason: Reason, error: string): string {
  return `The work is not moving: the ${cause(reason, error)} stopped this thread, the harness resumed the same session after waiting for it to clear, and the thread stopped on the same error again before making any progress, so waiting and resuming on its own does not move the task. Decide how to proceed; the same session continues with the decision.`;
}

const providerWaitText = { REASON_LABEL, cause, stallKey, stallText };

export default providerWaitText;
