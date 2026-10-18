import { NodeServices } from "@effect/platform-node";
import { CONFIG_DIR_NAME, type ExtensionAPI, getAgentDir } from "@msa/coding-agent";
import { Effect, ManagedRuntime, Path } from "effect";

import { discoverAgents } from "./agents.ts";
import { dispatch } from "./dispatch.ts";
import { renderCall, renderResult } from "./render.ts";
import {
  type DispatchDefaults,
  SubagentParams,
  type SubagentDetails,
  type SingleResult,
} from "./types.ts";

const pathService = ManagedRuntime.make(NodeServices.layer).runSync(Path.Path);

const description = (): string =>
  [
    "Delegate tasks to specialized subagents with isolated context.",
    "Modes: single (agent + task), parallel (tasks array), chain (sequential with {previous} placeholder).",
    `Default agent scope is "user" (from ${pathService.join(getAgentDir(), "agents")}).`,
    `To enable project-local agents in ${CONFIG_DIR_NAME}/agents, set agentScope: "both" (or "project").`,
  ].join(" ");

export default function (msa: ExtensionAPI) {
  msa.registerTool({
    name: "subagent",
    label: "Subagent",
    description: description(),
    parameters: SubagentParams,

    execute: (_toolCallId, params, signal, onUpdate, ctx) =>
      Effect.runPromise(
        Effect.gen(function* () {
          const agentScope = params.agentScope ?? "user";
          const discovery = discoverAgents(ctx.cwd, agentScope);
          const dispatchDefaults: DispatchDefaults = {
            model: ctx.model === undefined ? undefined : `${ctx.model.provider}/${ctx.model.id}`,
            thinkingLevel: ctx.thinkingLevel,
          };

          const makeDetails =
            (mode: SubagentDetails["mode"]) =>
            (results: SingleResult[]): SubagentDetails => ({
              mode,
              agentScope,
              projectAgentsDir: discovery.projectAgentsDir,
              results,
            });

          return yield* dispatch({
            context: {
              ctx,
              signal,
              onUpdate,
              agents: discovery.agents,
              dispatchDefaults,
              projectAgentsDir: discovery.projectAgentsDir,
              makeDetails,
            },
            params,
            agentScope,
            confirm: params.confirmProjectAgents ?? true,
          });
        }),
      ),

    renderCall: (args, theme) => renderCall({ args, theme }),
    renderResult: (result, options, theme) => renderResult({ result, options, theme }),
  });
}
