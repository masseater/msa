import { Type } from "typebox";

import type { ToolDefinition } from "../extensions/types.ts";
import type { Orchestrator } from "./orchestrator.ts";
import { tool } from "./tool-support.ts";

const handoffSchema = Type.Object({
  premise: Type.String({
    description:
      "What the next session must take as given: the repository, the models to use, the conventions and decisions in force. Written from this conversation.",
  }),
  goals: Type.String({
    description:
      "The goal states in dependency order, so the next session can create_task them with dependencies. Written from this conversation.",
  }),
  donts: Type.String({
    description:
      'What the next session must not start, and why. Write "none" when there is nothing.',
  }),
  path: Type.Optional(
    Type.String({
      description:
        "Where to write the file; a directory gets a generated name. Defaults to the handoffs directory of the agent dir.",
    }),
  ),
});

export function handoffTools(orchestrator: Orchestrator): Record<string, ToolDefinition> {
  return {
    handoff: tool({
      name: "handoff",
      label: "handoff",
      description:
        "Write the orchestrator's state to one Markdown file so a new msa process can resume it. The tool fills in the tasks, shared notes, replans, running and waiting sessions, and open PRs and issues; you write only premise, goals, and donts. Returns the line a person pastes into the next session.",
      promptSnippet: "Write the orchestrator's state to a file for the next session",
      promptGuidelines: [
        "Use handoff only when the user runs /handoff. Reply with the tool result exactly as returned, and nothing else.",
      ],
      parameters: handoffSchema,
      run: (input) =>
        orchestrator
          .handoff({
            premise: input.premise,
            goals: input.goals,
            donts: input.donts,
            ...(input.path === undefined ? {} : { path: input.path }),
          })
          .then((result) => [result.line, result.notice].filter(Boolean).join("\n")),
    }),
  };
}
