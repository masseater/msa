import { Type } from "typebox";

import type extensionsTypesTypes from "../extensions/types.types.ts";
import type orchestratorTypes from "./orchestrator.types.ts";
import toolSupport from "./tool-support.ts";

const { tool } = toolSupport;

const handoffSchema = Type.Object({
  donts: Type.String({
    description:
      'What the next session must not start, and why. Write "none" when there is nothing.',
  }),
  goals: Type.String({
    description:
      "The goal states in dependency order, so the next session can create_task them with dependencies. Written from this conversation.",
  }),
  path: Type.Optional(
    Type.String({
      description:
        "Where to write the file; a directory gets a generated name. Defaults to the handoffs directory of the agent dir.",
    }),
  ),
  premise: Type.String({
    description:
      "What the next session must take as given: the repository, the models to use, the conventions and decisions in force. Written from this conversation.",
  }),
});

function handoffTools(
  orchestrator: orchestratorTypes.Orchestrator,
): Record<string, extensionsTypesTypes.ToolDefinition> {
  return {
    handoff: tool({
      description:
        "Write the orchestrator's state to one Markdown file so a new msa process can resume it. The tool fills in the tasks, shared notes, replans, running and waiting threads, and open PRs and issues; you write only premise, goals, and donts. Returns the line a person pastes into the next session.",
      label: "handoff",
      name: "handoff",
      parameters: handoffSchema,
      promptGuidelines: [
        "Use handoff only when the user runs /handoff. Reply with the tool result exactly as returned, and nothing else.",
      ],
      promptSnippet: "Write the orchestrator's state to a file for the next session",
      run: (input) =>
        orchestrator
          .handoff({
            donts: input.donts,
            goals: input.goals,
            premise: input.premise,
            ...(input.path === undefined ? {} : { path: input.path }),
          })
          .then((result) => [result.line, result.notice].filter(Boolean).join("\n")),
    }),
  };
}

const toolsHandoff = {
  handoffTools,
};

export default toolsHandoff;
