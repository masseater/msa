import { getAgentDir, type InlineExtension } from "@msa/coding-agent";
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
      name: "eval-system-prompt-transform",
      hidden: true,
      factory: (msa) => {
        msa.on("before_agent_start", ({ systemPrompt }) => {
          const forced = transform(systemPrompt);
          onForced(forced);
          return { systemPrompt: forced };
        });
      },
    },
  ];
};

const resolveHost = <TOutput extends JsonValue>(options: Options<TOutput>): HostSelection => ({
  selection: resolveModelSelection(options.model, {
    MSA_PROVIDER: readEnv("MSA_PROVIDER"),
    MSA_MODEL: readEnv("MSA_MODEL"),
  }),
  authPath: pathOperations.join(getAgentDir(), "auth.json"),
  sandboxIdentity: resolveSandboxIdentity(),
});

const pathsUnder = (root: string): RunPaths => {
  const isolatedHome = pathOperations.join(root, "home");
  return {
    root,
    workspace: pathOperations.join(root, "workspace"),
    isolatedHome,
    agentDir: pathOperations.join(isolatedHome, ".msa", "agent"),
  };
};

export const createRunContext = <TOutput extends JsonValue>(options: Options<TOutput>) =>
  Effect.gen(function* () {
    const host = resolveHost(options);
    const paths = pathsUnder(yield* files.makeTempDirectory("msa-eval-"));
    const state: RunState<TOutput> = {
      forcedSystemPrompt: undefined,
      sessionManager: undefined,
      session: undefined,
      result: undefined,
      diagnostics: undefined,
      hiddenCredential: undefined,
    };
    const extensionFactories = systemPromptTransform(options, (prompt) => {
      state.forcedSystemPrompt = prompt;
    });
    return { host, paths, state, extensionFactories };
  });
