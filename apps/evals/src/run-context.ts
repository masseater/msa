import { type InlineExtension, getAgentDir } from "@msa/coding-agent";
import { Effect } from "effect";
import type { JsonValue } from "vitest-evals/harness";

import { resolveModelSelection } from "./model-selection.ts";
import { files, pathOperations, readEnv } from "./platform.ts";
import type { HostSelection, Options, RunPaths, RunState } from "./run-types.ts";
import { resolveSandboxIdentity } from "./sandbox.ts";

const systemPromptTransform = <TOutput extends JsonValue>(
  options: Options<TOutput>,
  onForced: (prompt: string) => void,
): InlineExtension[] => {
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

const resolveHost = <TOutput extends JsonValue>(options: Options<TOutput>): HostSelection => ({
  authPath: pathOperations.join(getAgentDir(), "auth.json"),
  sandboxIdentity: resolveSandboxIdentity(),
  selection: resolveModelSelection(options.model, {
    MSA_PROVIDER: readEnv("MSA_PROVIDER"),
    MSA_MODEL: readEnv("MSA_MODEL"),
  }),
});

const pathsUnder = (root: string): RunPaths => ({
  agentDir: pathOperations.join(root, "agent"),
  root,
  workspace: pathOperations.join(root, "workspace"),
});

export const createRunContext = <TOutput extends JsonValue>(options: Options<TOutput>) =>
  Effect.gen(function* () {
    const host = resolveHost(options);
    const paths = pathsUnder(yield* files.makeTempDirectory("msa-eval-"));
    const state: RunState<TOutput> = {
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
