import { Type } from "@msa/ai";
import { defineTool } from "@msa/coding-agent";
import { Effect } from "effect";
import { expect } from "vite-plus/test";
import { describeEval, toolCalls } from "vitest-evals";

import { createMsaCodingAgentHarness } from "../src/harness.ts";
import { files, pathOperations } from "../src/platform.ts";

const TOOL_NAME = "submit_documentation_audit";
const submitAudit = defineTool({
  name: TOOL_NAME,
  label: "Submit documentation audit",
  description: "Submit the final verdict after completing the documentation investigation.",
  promptSnippet: "Submit the final documentation audit as validated structured data",
  parameters: Type.Object(
    {
      verdict: Type.Union([
        Type.Literal("match"),
        Type.Literal("mismatch"),
        Type.Literal("inconclusive"),
      ]),
      explanation: Type.String({ minLength: 1, maxLength: 2000 }),
    },
    { additionalProperties: false },
  ),
  constrainedSampling: { type: "json_schema", strict: "prefer" },
  execute: (_toolCallId, params) =>
    Promise.resolve({
      content: [{ type: "text", text: "Documentation audit submitted." }],
      details: params,
      terminate: true,
    }),
});

const repositoryRoot = pathOperations.resolve(import.meta.dirname, "../../..");
const docsRoot = pathOperations.resolve(repositoryRoot, "apps/coding-agent/docs");
const pages = (await Effect.runPromise(files.glob("**/*.md", docsRoot)))
  .map((path) => ({ path: path.replaceAll("\\", "/") }))
  .sort((left, right) => left.path.localeCompare(right.path));
const harness = createMsaCodingAgentHarness({
  name: "documentation-page-audit",
  tools: ["read", "grep", "find", "ls", TOOL_NAME],
  customTools: [submitAudit],
});

const auditPrompt = (
  documentationPath: string,
): string => `Audit this msa documentation page against the repository implementation.

Documentation page: ${documentationPath}
Repository root: ${repositoryRoot}

Read the complete page and the relevant implementation. Report a mismatch only for a clear, user-visible contradiction between an explicit documentation claim and actual runtime behavior. Follow the runtime path; names, comments, types, isolated helpers, and tests are not sufficient evidence by themselves.

Missing internal detail, ambiguous wording, hypothetical misuse, and undocumented edge cases are not mismatches. If the evidence is not decisive, report inconclusive. Otherwise report match.

For a mismatch, quote the claim, cite the implementation path and symbol, and state the concrete behavior a user would observe.

Call ${TOOL_NAME} exactly once as your final action. Do not return prose.`;

describeEval("Audit documentation against implementation", { harness }, (it) => {
  it.for(pages)("$path matches the implementation", ({ path }, { run }) =>
    Effect.runPromise(
      Effect.gen(function* () {
        const documentationPath = pathOperations.resolve(docsRoot, path);
        const result = yield* Effect.promise(() => run(auditPrompt(documentationPath)));
        const auditCalls = toolCalls(result).filter((call) => call.name === TOOL_NAME);
        expect(auditCalls).toHaveLength(1);
        const auditCall = auditCalls[0];
        expect(auditCall?.status).toBe("ok");
        const explanation = auditCall?.arguments?.["explanation"];
        expect(
          auditCall?.arguments?.["verdict"],
          typeof explanation === "string" ? explanation : undefined,
        ).toBe("match");
      }),
    ),
  );
});
