import html from "../../utils/html.ts";
import type goalCheckTextTypes from "./goal-check-text.types.ts";
import promptsModule from "./prompts.ts";

const { prompts } = promptsModule;
const { escapeXml } = html;

const OUTPUT_LIMIT = 3000;

type CheckResult = goalCheckTextTypes.CheckResult;
type GateResult = goalCheckTextTypes.GateResult;
type Verification = goalCheckTextTypes.Verification;

function clip(output: string): string {
  return output.length <= OUTPUT_LIMIT ? output : `[…]\n${output.slice(-OUTPUT_LIMIT)}`;
}

function resultsText(results: readonly CheckResult[]): string {
  return results
    .map((result) => {
      const got = result.exitCode === null ? "no exit code" : `exit ${result.exitCode}`;
      return [
        `<check command="${escapeXml(result.check.command)}" expected="${escapeXml(prompts.checkExpectation(result.check))}" got="${got}" passed="${result.passed}">`,
        escapeXml(clip(result.output.trim())),
        "</check>",
      ].join("\n");
    })
    .join("\n");
}

function gateText(gates: readonly GateResult[]): string {
  return gates
    .filter((gate) => gate.problems.length > 0)
    .map((gate) =>
      [
        `<pull-request task="${escapeXml(gate.task.id)}"${gate.number === null ? "" : ` number="${gate.number}"`}>`,
        ...gate.problems.map((problem) => `- ${escapeXml(problem.text)}`),
        "</pull-request>",
      ].join("\n"),
    )
    .join("\n");
}

function failureText(verification: Verification): string {
  return [resultsText(verification.checks), gateText(verification.pullRequests)]
    .filter(Boolean)
    .join("\n");
}

function rejectionPrompt(verification: Verification): string {
  return [
    "<goal-checks-failed>",
    "You ended your turn, but the goal's checks do not pass yet, so the task is not complete. Make the work satisfy them; do not change the checks or what they inspect to make them pass. End your turn when every check passes.",
    failureText(verification),
    "</goal-checks-failed>",
  ].join("\n");
}

function passed(verification: Verification): boolean {
  return (
    verification.checks.every((result) => result.passed) &&
    verification.pullRequests.every(
      (gate) => gate.problems.length === 0 && gate.unavailable === undefined,
    )
  );
}

function unavailableText(verification: Verification): string | undefined {
  const reasons = verification.pullRequests.flatMap((gate) => gate.unavailable ?? []);
  return reasons.length === 0 ? undefined : reasons.join("\n");
}

function waitingForCi(verification: Verification): boolean {
  const problems = verification.pullRequests.flatMap((gate) => gate.problems);
  return (
    verification.checks.every((result) => result.passed) &&
    problems.length > 0 &&
    problems.every((problem) => problem.kind === "pending")
  );
}

const goalCheckText = { failureText, passed, rejectionPrompt, unavailableText, waitingForCi };

export default goalCheckText;
