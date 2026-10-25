import type triageTypes from "./triage.types.ts";

type Conclusion = triageTypes.Conclusion;

const HUMAN_REASONS: Record<triageTypes.HumanReason, string> = {
  billing: "billing",
  "key-revocation": "revoking an existing key or token",
  "personal-data": "personal data",
  "undecided-spec": "a choice of specification nobody has made yet",
};

const ANSWER =
  "Decide how to proceed, with the user or an advisor if needed, and answer with send_message; the thread that stopped continues from where it stopped with your answer.";

function decisionText(conclusion: Extract<Conclusion, { conclusion: "decided" }>): string {
  return [
    `<decision>\n${conclusion.decision}\n</decision>`,
    `<grounds>\n${conclusion.grounds}\n</grounds>`,
    "<goal-items>",
    ...[...conclusion.goalItems]
      .sort((left, right) => left.item - right.item)
      .map((entry) => `${entry.item}. ${entry.how}`),
    "</goal-items>",
  ].join("\n");
}

function decidedLine(conclusion: Extract<Conclusion, { conclusion: "decided" }>): string {
  return [
    "Triage decided without a human: the task does not wait for you, and the thread that stopped continues from where it stopped with this decision.",
    decisionText(conclusion),
  ].join("\n");
}

function why(conclusion: Conclusion | undefined): string {
  if (conclusion === undefined) {
    return "The triage thread ended without a conclusion, so the decision goes to you.";
  }
  if (conclusion.conclusion === "compromise") {
    return `The only way the triage found ${conclusion.compromises.join(", ")}, which is a compromise rather than a way to proceed, so the decision goes to you.\n<triage-view>\n${conclusion.decision}\n${conclusion.grounds}\n</triage-view>`;
  }
  if (conclusion.conclusion === "needs-human") {
    return `Triage: only the user can decide this (${HUMAN_REASONS[conclusion.humanReason]}). ${conclusion.noPrecedent}\n<triage-view>\n${conclusion.decision}\n${conclusion.grounds}\n</triage-view>`;
  }
  return "";
}

function escalationLine(conclusion: Conclusion | undefined, request: string): string {
  return [why(conclusion), ANSWER, `<request>\n${request}\n</request>`].join("\n");
}

function repeatLine(request: string): string {
  return [
    "The same request came back after a triage decided it, with the request repeated or no file changed since that decision, so it goes to you instead of to another triage.",
    ANSWER,
    `<request>\n${request}\n</request>`,
  ].join("\n");
}

const triageText = { HUMAN_REASONS, decidedLine, decisionText, escalationLine, repeatLine };

export default triageText;
