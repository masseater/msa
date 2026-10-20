import type { AssistantMessageEvent, TranscriptContext } from "@msa/ai/compat";
import testing from "@msa/testing";
import { Data, Effect, Stream } from "effect";
import { afterEach, beforeEach, describe, expect, it, vi } from "vite-plus/test";

import { completeAccountsArgument, runAccountsCommand } from "../src/core/accounts.ts";
import { loadAccounts } from "../src/core/cli-agents/claude-accounts.ts";
import { openCodeProvider } from "../src/core/cli-agents/opencode.ts";
import cliAgentsSupport from "./cli-agents-support.ts";

const { awaited, joinPath, runTest } = testing;
const { cleanAgentDir, currentAgentDir, prepareAgentDir, writeAccounts, writeScript } =
  cliAgentsSupport;

class StreamFailed extends Data.TaggedError("StreamFailed")<{ readonly cause: unknown }> {}

beforeEach(() => runTest(prepareAgentDir));

afterEach(() => runTest(cleanAgentDir));

function context2() {
  const notes: string[] = [];
  let refreshes = 0;
  const ctx = {
    refreshProviders: () =>
      runTest(
        Effect.sync(() => {
          refreshes += 1;
        }),
      ),
    ui: {
      confirm: () => runTest(Effect.succeed(true)),
      input: () => runTest(Effect.as(Effect.void, undefined)),
      notify: (message: string) => notes.push(message),
    },
  };
  return { ctx, notes, refreshes: () => refreshes };
}

const completesKindsThenTheKindSActions = () =>
  runTest(
    Effect.gen(function* () {
      yield* writeAccounts([{ name: "main" }, { name: "sub" }]);
      const complete = completeAccountsArgument;
      expect((yield* awaited(complete("cl")))?.map((item) => item.value)).toEqual(["claude "]);
      expect((yield* awaited(complete("claude lo")))?.map((item) => item.value)).toEqual([
        "claude login ",
        "claude logout ",
      ]);
      expect((yield* awaited(complete("claude use s")))?.map((item) => item.value)).toEqual([
        "claude use sub",
      ]);
    }),
  );

const routesToTheKindAndRebuildsThe = () =>
  runTest(
    Effect.gen(function* () {
      vi.stubEnv("CLAUDE_BIN", "/bin/false");
      const { ctx, notes, refreshes } = context2();
      yield* awaited(runAccountsCommand("claude add token printf tok", ctx));
      expect(loadAccounts().map((account) => account.name)).toEqual(["default", "token"]);
      expect(refreshes()).toBe(1);
      yield* awaited(runAccountsCommand("", ctx));
      expect(notes.at(-1)).toMatch(/^claude:\n1\. default .*\n2\. token /u);
      yield* awaited(runAccountsCommand("nope", ctx));
      expect(notes.at(-1)).toMatch(/Unknown account kind "nope"/u);
    }),
  );

describe("/accounts", () => {
  it(
    "completes kinds, then the kind's actions and account names",
    completesKindsThenTheKindSActions,
  );

  it(
    "routes to the kind and rebuilds the providers when the account list changes",
    routesToTheKindAndRebuildsThe,
  );
});

const run = Effect.fn("run")(function* (script: string) {
  const dir = currentAgentDir();
  const bin = joinPath(dir, "opencode");
  yield* writeScript(bin, `cat > "${dir}/stdin.txt"\n${script}`);
  vi.stubEnv("OPENCODE_BIN", bin);
  const provider = openCodeProvider();
  const model = provider.getModels()[0]!;
  const context = {
    messages: [{ content: "hello", role: "user", timestamp: 0 }],
  } as unknown as TranscriptContext;
  const events: AssistantMessageEvent[] = [];
  yield* Stream.runForEach(
    Stream.fromAsyncIterable(
      provider.streamSimple(model, context),
      (cause) => new StreamFailed({ cause }),
    ),
    (event) => Effect.sync(() => events.push(event)),
  ).pipe(Effect.orDie);
  return events;
});

const streamsTheCliSTextAndUsage = () =>
  runTest(
    Effect.gen(function* () {
      const events = yield* run(
        [
          `echo '{"type":"text","part":{"id":"a","type":"text","text":"Hi"}}'`,
          `echo '{"type":"text","part":{"id":"a","type":"text","text":"Hi there"}}'`,
          `echo '{"type":"step_finish","part":{"tokens":{"input":5,"output":2,"cache":{"read":1,"write":0}}}}'`,
        ].join("\n"),
      );
      const done = events.at(-1);
      expect(done?.type).toBe("done");
      if (done?.type !== "done") return;
      expect(done.message.content).toEqual([{ text: "Hi there", type: "text" }]);
      expect(done.message.usage).toMatchObject({
        cacheRead: 1,
        input: 5,
        output: 2,
        totalTokens: 8,
      });
    }),
  );

const reportsAnErrorEventAsAFailed = () =>
  runTest(
    Effect.gen(function* () {
      const events = yield* run(`echo '{"type":"error","error":{"message":"quota exceeded"}}'`);
      const last = events.at(-1);
      expect(last?.type).toBe("error");
      if (last?.type !== "error") return;
      expect(last.error.errorMessage).toBe("quota exceeded");
    }),
  );

describe("opencode-free provider", () => {
  it("streams the CLI's text and usage as the reply", streamsTheCliSTextAndUsage);

  it(
    "reports an error event as a failed reply even when the CLI exits 0",
    reportsAnErrorEventAsAFailed,
  );
});
