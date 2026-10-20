import codingAgent from "@msa/coding-agent";
import type codingAgentTypes from "@msa/coding-agent/index.types";
import { Effect } from "effect";

import agentsModule from "./agents.ts";
import dispatchModule from "./dispatch.ts";
import render from "./render.ts";
import subagentTypes from "./types.ts";
import type subagentTypesTypes from "./types.types.ts";

const { discoverAgents, joinPath } = agentsModule;
const { CONFIG_DIR_NAME, getAgentDir } = codingAgent;
const { SubagentParams } = subagentTypes;
const { dispatch } = dispatchModule;
const { renderCall, renderResult } = render;

const description = (): string =>
  [
    "Delegate tasks to specialized subagents with isolated context.",
    "Modes: single (agent + task), parallel (tasks array), chain (sequential with {previous} placeholder).",
    `Default agent scope is "user" (from ${joinPath(getAgentDir(), "agents")}).`,
    `To enable project-local agents in ${CONFIG_DIR_NAME}/agents, set agentScope: "both" (or "project").`,
  ].join(" ");

export default function (msa: codingAgentTypes.ExtensionAPI) {
  msa.registerTool({
    description: description(),
    execute: (_toolCallId, params, signal, onUpdate, ctx) =>
      Effect.runPromise(
        Effect.gen(function* () {
          const agentScope = params.agentScope ?? "user";
          const discovery = yield* discoverAgents(ctx.cwd, agentScope);
          const dispatchDefaults: subagentTypesTypes.DispatchDefaults = {
            model: ctx.model === undefined ? undefined : `${ctx.model.provider}/${ctx.model.id}`,
            thinkingLevel: ctx.thinkingLevel,
          };

          const makeDetails =
            (mode: subagentTypesTypes.SubagentDetails["mode"]) =>
            (results: subagentTypesTypes.SingleResult[]): subagentTypesTypes.SubagentDetails => ({
              agentScope,
              mode,
              projectAgentsDir: discovery.projectAgentsDir,
              results,
            });

          return yield* dispatch({
            agentScope,
            confirm: params.confirmProjectAgents ?? true,
            context: {
              agents: discovery.agents,
              ctx,
              dispatchDefaults,
              makeDetails,
              onUpdate,
              projectAgentsDir: discovery.projectAgentsDir,
              signal,
            },
            params,
          });
        }),
      ),
    label: "Subagent",
    name: "subagent",
    parameters: SubagentParams,
    renderCall: (args, theme) => renderCall({ args, theme }),
    renderResult: (result, options, theme) => renderResult({ options, result, theme }),
  });
}
