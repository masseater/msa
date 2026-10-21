import { parseArgs } from "node:util";

import { Type } from "typebox";

import type probeInputTypes from "./codex-websocket-cached-probe-input.types.ts";

type ProbeArgs = probeInputTypes.ProbeArgs;

const TRANSPORTS = ["sse", "websocket", "websocket-cached", "auto"] as const;
const REASONING_LEVELS = ["minimal", "low", "medium", "high", "xhigh", "max"] as const;

const oneOf = <T extends string>(allowed: readonly T[], flag: string, value: string): T => {
  const match = allowed.find((candidate) => candidate === value);
  if (match === undefined) throw new Error(`Invalid --${flag}: ${value}`);
  return match;
};

const readArgs = (now: number): ProbeArgs => {
  const { values } = parseArgs({
    options: {
      "max-tokens": { default: "64", type: "string" },
      reasoning: { default: "low", type: "string" },
      "session-id": { default: `msa-ai-codex-ws-cached-probe-${now}`, type: "string" },
      transport: { default: "websocket-cached", type: "string" },
      turns: { default: "20", type: "string" },
    },
  });
  return {
    maxTokens: Number.parseInt(values["max-tokens"], 10),
    reasoning: oneOf(REASONING_LEVELS, "reasoning", values.reasoning),
    sessionId: values["session-id"],
    transport: oneOf(TRANSPORTS, "transport", values.transport),
    turns: Number.parseInt(values.turns, 10),
  };
};

const buildPrompt = (turn: number) => {
  const marker = `TURN-${String(turn).padStart(2, "0")}-MARKER-${(turn * 17 + 13) % 97}`;
  const padding = Array.from(
    { length: 180 },
    (_, index) =>
      `Turn ${turn} synthetic record ${String(index + 1).padStart(3, "0")}: alpha beta gamma delta epsilon zeta eta theta iota kappa lambda mu nu xi omicron msa rho sigma tau upsilon phi chi psi omega.`,
  );
  return [
    "This is an automated OpenAI Codex Responses websocket cache probe.",
    `Task for turn ${turn}: call deterministic_probe exactly once before your final answer.`,
    `Use tool arguments: turn=${turn}, marker=${marker}`,
    `After the tool result arrives, reply exactly: TURN ${turn} OK ${marker}`,
    "The following repeated block is intentional benchmark padding.",
    ...padding,
  ].join("\n");
};

const probeTool = {
  description:
    "Mandatory benchmark tool. Call exactly once with the turn and marker from the user prompt.",
  name: "deterministic_probe",
  parameters: Type.Object({ marker: Type.String(), turn: Type.Number() }),
};

const codexWebsocketCachedProbeInput = { buildPrompt, probeTool, readArgs };

export default codexWebsocketCachedProbeInput;
