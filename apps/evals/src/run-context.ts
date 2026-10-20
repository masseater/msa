import codingAgent from "@msa/coding-agent";
import type codingAgentTypes from "@msa/coding-agent/index.types";
import { Effect } from "effect";
import type { JsonValue } from "vitest-evals/harness";

import modelSelection from "./model-selection.ts";
import platform from "./platform.ts";
import type runTypesTypes from "./run-types.ts";
import sandbox from "./sandbox.ts";

const { getAgentDir } = codingAgent;
const { files, pathOperations, readEnv } = platform;
const { resolveSandboxIdentity } = sandbox;
const { resolveModelSelection } = modelSelection;

const systemPromptTransform = <TOutput extends JsonValue>(
  options: runTypesTypes.Options<TOutput>,
  onForced: (prompt: string) => void,
): codingAgentTypes.InlineExtension[] => {
  const transform = options.transformSystemPrompt;
  if (transform === undefined) return [];
  return [
    {
      factory: (msa) => {
        msa.on("before_agent_start", ({ systemPrompt }) => {
          const forced = transform(systemPrompt);
          onForced(forced);
          return { systemPrompt: forced };
        });
      },
      hidden: true,
      name: "eval-system-prompt-transform",
    },
  ];
};

const resolveHost = <TOutput extends JsonValue>(
  options: runTypesTypes.Options<TOutput>,
): runTypesTypes.HostSelection => ({
  authPath: pathOperations.join(getAgentDir(), "auth.json"),
  sandboxIdentity: resolveSandboxIdentity(),
  selection: resolveModelSelection(options.model, {
    MSA_MODEL: readEnv("MSA_MODEL"),
    MSA_PROVIDER: readEnv("MSA_PROVIDER"),
  }),
});

const pathsUnder = (root: string): runTypesTypes.RunPaths => ({
  agentDir: pathOperations.join(root, "agent"),
  root,
  workspace: pathOperations.join(root, "workspace"),
});

const createRunContext = <TOutput extends JsonValue>(options: runTypesTypes.Options<TOutput>) =>
  Effect.gen(function* () {
    const host = resolveHost(options);
    const paths = pathsUnder(yield* files.makeTempDirectory("msa-eval-"));
    const state: runTypesTypes.RunState<TOutput> = {
      diagnostics: undefined,
      forcedSystemPrompt: undefined,
      result: undefined,
      session: undefined,
      sessionManager: undefined,
    };
    const extensionFactories = systemPromptTransform(options, (prompt) => {
      state.forcedSystemPrompt = prompt;
    });
    return { extensionFactories, host, paths, state };
  });

const runContext = {
  createRunContext,
};

export default runContext;
