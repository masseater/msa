import ai from "@msa/ai";
import { Effect } from "effect";
import { afterEach, describe, expect, it } from "vite-plus/test";

import type toolTypes from "../../src/extensions/codemode/tool.types.ts";
import agentSessionCodemodeSupport from "./agent-session-codemode-support.ts";
import agentSessionCodemodeSupport2 from "./agent-session-codemode-support2.ts";

const { fauxAssistantMessage, fauxToolCall } = ai;

const { harnesses, setup } = agentSessionCodemodeSupport2;

const { codemodeResult, resultText, trackCodemodeWorkers } = agentSessionCodemodeSupport;

trackCodemodeWorkers();

const marksWhereEachTextItemStarts = Effect.gen(function* () {
  const harness = yield* setup();
  harness.setResponses([
    fauxAssistantMessage(
      [
        fauxToolCall("codemode", {
          code: 'text("one\\ntwo");\nconsole.log("a");\nconsole.log("b");\ntext("three\\n");\nreturn 4;',
        }),
      ],
      { stopReason: "toolUse" },
    ),
    fauxAssistantMessage("done"),
  ]);

  yield* Effect.promise(() => harness.session.prompt("go"));

  const result = codemodeResult(harness);
  expect(result.content).toHaveLength(2);
  expect(resultText(result)).toBe(
    "==> text 1/3 <==\none\ntwo\n==> text 2/3 <==\nthree\n==> text 3/3 <==\n4\n<console_output>\na\nb\n</console_output>",
  );
});

const reportsScriptFailuresAsResultsThat = Effect.gen(function* () {
  const harness = yield* setup();
  harness.setResponses([
    fauxAssistantMessage(
      [
        fauxToolCall("codemode", {
          code: `text("partial");\nconsole.log("log");\nawait tools.echo({ text: "x" });\nthrow new Error("boom");`,
        }),
      ],
      { stopReason: "toolUse" },
    ),
    fauxAssistantMessage("done"),
  ]);

  yield* Effect.promise(() => harness.session.prompt("go"));

  const result = codemodeResult(harness);
  expect(result.isError).toBe(true);
  expect((result.content[0] as { text: string }).text).toMatch(/^Script failed\n/u);
  const text = resultText(result);
  expect(text).toMatch(
    /^partial\n<console_output>\nlog\n<\/console_output>\nScript error:\nError: boom\n/u,
  );
  expect(text).toContain("codemode.js:4");
  expect(text).toContain("Tool calls made before the failure (they are not undone): echo (ok)");
  expect(
    (result.details as unknown as toolTypes.CodemodeToolDetails).calls.map((call) => call.name),
  ).toEqual(["echo"]);
});

const marksWhereEachTextItemStartsAnd = () => Effect.runPromise(marksWhereEachTextItemStarts);

const reportsScriptFailuresAsResultsThatKeep = () =>
  Effect.runPromise(reportsScriptFailuresAsResultsThat);

describe("AgentSession codemode tool", () => {
  afterEach(() => {
    while (harnesses.length > 0) harnesses.pop()?.cleanup();
  });

  it(
    "marks where each text item starts and puts console lines last in one text block",
    marksWhereEachTextItemStartsAnd,
  );
});

describe("AgentSession codemode tool", () => {
  afterEach(() => {
    while (harnesses.length > 0) harnesses.pop()?.cleanup();
  });

  it(
    "reports script failures as results that keep partial output and the calls that ran",
    reportsScriptFailuresAsResultsThatKeep,
  );
});
