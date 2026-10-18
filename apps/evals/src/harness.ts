import { Cause, Effect, Exit } from "effect";
import { createHarness, type Harness, type JsonValue } from "vitest-evals/harness";

import type {
  MsaCodingAgentHarnessOptions,
  MsaCodingAgentHarnessWithOutput,
  MsaCodingAgentInput,
} from "./harness-types.ts";
import { readEnv } from "./platform.ts";
import { runMsaCodingAgent } from "./run-agent.ts";
import { resolveSandboxIdentity } from "./sandbox.ts";
import {
  DOCUMENTATION_EVAL_TOOLS,
  excludeMsaDocumentation,
  resolveDocumentationVariant,
} from "./system-prompt.ts";

const settle = <A>(effect: Effect.Effect<A>): Promise<A> =>
  Effect.runPromiseExit(effect).then((exit) =>
    Exit.isSuccess(exit) ? exit.value : Promise.reject(Cause.squash(exit.cause)),
  );

export function createMsaCodingAgentHarness<TOutput extends JsonValue>(
  options: MsaCodingAgentHarnessWithOutput<TOutput>,
): Harness<MsaCodingAgentInput, TOutput>;
export function createMsaCodingAgentHarness(
  options?: MsaCodingAgentHarnessOptions,
): Harness<MsaCodingAgentInput, string>;
export function createMsaCodingAgentHarness<TOutput extends JsonValue>(
  options: MsaCodingAgentHarnessOptions | MsaCodingAgentHarnessWithOutput<TOutput> = {},
): Harness<MsaCodingAgentInput, string | TOutput> {
  return createHarness<MsaCodingAgentInput, string | TOutput>({
    name: options.name ?? "msa-coding-agent",
    run: ({ input, signal, setArtifact }) =>
      settle(runMsaCodingAgent({ input, signal, setArtifact, options })),
  });
}

type DocumentationHarnessOptions = Omit<
  MsaCodingAgentHarnessOptions,
  "name" | "transformSystemPrompt" | "expectedMsaDocumentation"
>;
type DocumentationHarnessWithOutput<TOutput extends JsonValue> = Omit<
  MsaCodingAgentHarnessWithOutput<TOutput>,
  "name" | "transformSystemPrompt" | "expectedMsaDocumentation"
>;

export function createMsaDocumentationEvalHarness<TOutput extends JsonValue>(
  options: DocumentationHarnessWithOutput<TOutput>,
): Harness<MsaCodingAgentInput, TOutput>;
export function createMsaDocumentationEvalHarness(
  options?: DocumentationHarnessOptions,
): Harness<MsaCodingAgentInput, string>;
export function createMsaDocumentationEvalHarness<TOutput extends JsonValue>(
  options: DocumentationHarnessOptions | DocumentationHarnessWithOutput<TOutput> = {},
) {
  if (readEnv("MSA_EVAL_CONTAINER") !== "1" || resolveSandboxIdentity() === undefined) {
    throw new Error("Documentation evals must run in the isolated container sandbox.");
  }
  const variant = resolveDocumentationVariant(readEnv("MSA_EVAL_VARIANT"));
  return createMsaCodingAgentHarness({
    ...options,
    name: variant,
    tools: options.tools ?? [...DOCUMENTATION_EVAL_TOOLS],
    ...(variant === "without_docs" ? { transformSystemPrompt: excludeMsaDocumentation } : {}),
    expectedMsaDocumentation: variant === "with_docs",
  });
}
