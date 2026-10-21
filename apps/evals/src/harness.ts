import { Cause, Effect, Exit } from "effect";
import { type Harness, type JsonValue, createHarness } from "vitest-evals/harness";

import type harnessTypesTypes from "./harness-types.ts";
import platform from "./platform.ts";
import runAgent from "./run-agent.ts";
import sandbox from "./sandbox.ts";
import systemPrompt from "./system-prompt.ts";

const { runMsaCodingAgent } = runAgent;
const { readEnv } = platform;
const { resolveSandboxIdentity } = sandbox;
const { DOCUMENTATION_EVAL_TOOLS, excludeMsaDocumentation, resolveDocumentationVariant } =
  systemPrompt;

const settle = <A>(effect: Effect.Effect<A>): Promise<A> =>
  Effect.runPromiseExit(effect).then((exit) =>
    Exit.isSuccess(exit) ? exit.value : Promise.reject(Cause.squash(exit.cause)),
  );

function createMsaCodingAgentHarness<TOutput extends JsonValue>(
  options: harnessTypesTypes.MsaCodingAgentHarnessWithOutput<TOutput>,
): Harness<harnessTypesTypes.MsaCodingAgentInput, TOutput>;
function createMsaCodingAgentHarness(
  options?: harnessTypesTypes.MsaCodingAgentHarnessOptions,
): Harness<harnessTypesTypes.MsaCodingAgentInput, string>;
function createMsaCodingAgentHarness<TOutput extends JsonValue>(
  options:
    | harnessTypesTypes.MsaCodingAgentHarnessOptions
    | harnessTypesTypes.MsaCodingAgentHarnessWithOutput<TOutput> = {},
): Harness<harnessTypesTypes.MsaCodingAgentInput, string | TOutput> {
  return createHarness<harnessTypesTypes.MsaCodingAgentInput, string | TOutput>({
    name: options.name ?? "msa-coding-agent",
    run: ({ input, signal, setArtifact }) =>
      settle(runMsaCodingAgent({ input, options, setArtifact, signal })),
  });
}

type DocumentationHarnessOptions = Omit<
  harnessTypesTypes.MsaCodingAgentHarnessOptions,
  "name" | "transformSystemPrompt" | "expectedMsaDocumentation"
>;
type DocumentationHarnessWithOutput<TOutput extends JsonValue> = Omit<
  harnessTypesTypes.MsaCodingAgentHarnessWithOutput<TOutput>,
  "name" | "transformSystemPrompt" | "expectedMsaDocumentation"
>;

function createMsaDocumentationEvalHarness<TOutput extends JsonValue>(
  options: DocumentationHarnessWithOutput<TOutput>,
): Harness<harnessTypesTypes.MsaCodingAgentInput, TOutput>;
function createMsaDocumentationEvalHarness(
  options?: DocumentationHarnessOptions,
): Harness<harnessTypesTypes.MsaCodingAgentInput, string>;
function createMsaDocumentationEvalHarness<TOutput extends JsonValue>(
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

const harness = {
  createMsaCodingAgentHarness,
  createMsaDocumentationEvalHarness,
};

export default harness;
