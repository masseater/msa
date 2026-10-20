import { fauxAssistantMessage } from "@msa/ai";
import { Effect } from "effect";
import { afterEach, describe, expect, it } from "vite-plus/test";

import { parseArgs } from "../../../src/cli/args.ts";
import harnessModule from "../harness.ts";
import type harnessTypes from "../harness.types.ts";

const { createHarness, getUserTexts } = harnessModule;

let harness!: harnessTypes.Harness;

const stopsParsingOptionsWhileRetainingFile = () => {
  const parsed = parseArgs([
    "--unknown-flag",
    "value",
    "--",
    "--provider",
    "openai",
    "-c",
    "@prompt.md",
  ]);

  expect(parsed.unknownFlags.get("unknown-flag")).toBe("value");
  expect(parsed.provider).toBeUndefined();
  expect(parsed.continue).toBeUndefined();
  expect(parsed.messages).toEqual(["--provider", "openai", "-c"]);
  expect(parsed.fileArgs).toEqual(["prompt.md"]);
  expect(parsed.diagnostics).toEqual([]);
};

describe("issue #7269 CLI end-of-options delimiter", () => {
  afterEach(() => {
    harness?.cleanup();
  });
  it.each(["- summarize the following points for me", "--answer my question briefly"])(
    "passes %j as a prompt after --",
    (prompt) =>
      Effect.runPromise(
        Effect.gen(function* () {
          const parsed = parseArgs(["-ne", "--no-session", "-p", "--", prompt]);
          expect(parsed.messages).toEqual([prompt]);
          expect(parsed.unknownFlags.size).toBe(0);
          expect(parsed.diagnostics).toEqual([]);

          harness = yield* Effect.promise(() => createHarness());
          harness.setResponses([fauxAssistantMessage("ok")]);
          const [message] = parsed.messages;
          if (message === undefined) throw new Error("expected a parsed prompt message");
          yield* Effect.promise(() => harness.session.prompt(message));
          expect(getUserTexts(harness)).toEqual([prompt]);
        }),
      ),
  );
  it("stops parsing options while retaining @file handling", stopsParsingOptionsWhileRetainingFile);
});
