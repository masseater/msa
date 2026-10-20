import ai from "@msa/ai";
import { Effect } from "effect";
import { StructuredOutputJudge, ToolCallJudge, describeEval } from "vitest-evals";

import harnessModule from "../src/harness.ts";
import systemPrompt from "../src/system-prompt.ts";

const { createMsaDocumentationEvalHarness } = harnessModule;
const { DOCUMENTATION_EVAL_TOOLS } = systemPrompt;

const { contentText } = ai;

const TOOL_NAME = "hello";
const TOOL_ARGUMENTS = { name: "Bob" };
const TOOL_RESULT = "Hello, Bob!";

const harness = createMsaDocumentationEvalHarness({
  output: ({ response, session }) =>
    Effect.sync(() => {
      const extensions = session.resourceLoader.getExtensions();
      const result = [...session.messages]
        .reverse()
        .find(
          (message) =>
            message.role === "toolResult" && message.toolName === TOOL_NAME && !message.isError,
        );
      return {
        extensionErrors: extensions.errors,
        response,
        toolLoaded: extensions.extensions.some(({ tools }) => tools.has(TOOL_NAME)),
        toolResult: result?.role === "toolResult" ? contentText(result.content, "\n") : null,
      };
    }),
  tools: [...DOCUMENTATION_EVAL_TOOLS, TOOL_NAME],
});

describeEval(
  "Create and use a tool extension",
  {
    harness,
    judgeThreshold: null,
    judges: [
      StructuredOutputJudge({
        allowExtras: false,
        expected: {
          extensionErrors: [],
          response: TOOL_RESULT,
          toolLoaded: true,
          toolResult: TOOL_RESULT,
        },
        match: "strict",
      }),
      ToolCallJudge({ expectedTools: [{ arguments: TOOL_ARGUMENTS, name: TOOL_NAME }] }),
    ],
  },
  (it) => {
    it("creates, reloads, and invokes the extension", ({ run }) =>
      run([
        {
          content:
            "Configure this running msa installation with an extension containing a hello tool that takes a name and returns a greeting. Do not create project source. For example, passing Bob should return `Hello, Bob!`.",
          type: "prompt",
        },
        { type: "reload" },
        {
          content:
            "Use the hello tool to greet Bob. Respond with exactly the tool's greeting and nothing else.",
          type: "prompt",
        },
      ]));
  },
);
