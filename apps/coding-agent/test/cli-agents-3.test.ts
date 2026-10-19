import type { AssistantMessageEvent, Model, TranscriptContext } from "@msa/ai/compat";
import {
  awaited,
  changeMode,
  joinPath,
  makeTempDir,
  removePath,
  runTest,
  writeJsonFile,
  writeTextFile,
} from "@msa/testing";
import { Data, Effect, Stream } from "effect";
import { afterEach, beforeEach, describe, expect, it } from "vite-plus/test";

import { ENV_AGENT_DIR } from "../src/config.ts";
import type {
  ExtensionAPI,
  ExtensionCommandContext,
  ProviderConfig,
  RegisteredCommand,
} from "../src/core/extensions/types.ts";
import { deleteEnv, withEnv, writeEnv } from "../src/core/process-env.ts";
import accountsExtension from "../src/extensions/accounts/index.ts";
import { loadAccounts } from "../src/extensions/cli-agents/claude-accounts.ts";
import { registerOpenCode } from "../src/extensions/cli-agents/opencode.ts";

class StreamFailure extends Data.TaggedError("StreamFailure")<{ readonly cause: unknown }> {}

let dir = "";

beforeEach(() =>
  runTest(
    Effect.gen(function* () {
      dir = yield* makeTempDir("msa-cli-agents-commands-");
      yield* Effect.sync(() => writeEnv(ENV_AGENT_DIR, dir));
    }),
  ),
);

afterEach(() =>
  runTest(
    Effect.gen(function* () {
      yield* Effect.sync(() => deleteEnv(ENV_AGENT_DIR));
      yield* removePath(dir);
    }),
  ),
);

const writeAccounts = (accounts: unknown[]): Effect.Effect<void> =>
  writeJsonFile(joinPath(dir, "claude-code-accounts.json"), { accounts });

describe("/accounts", () => {
  const command = (): RegisteredCommand => {
    let registered: RegisteredCommand | undefined;
    accountsExtension({
      registerCommand: (name: string, options: Omit<RegisteredCommand, "name" | "sourceInfo">) => {
        if (name === "accounts") registered = options as RegisteredCommand;
      },
    } as unknown as ExtensionAPI);
    if (registered === undefined) throw new Error("command not registered");
    return registered;
  };

  const context = () => {
    const notes: string[] = [];
    let reloads = 0;
    const ctx = {
      hasUI: false,
      ui: { notify: (message: string) => notes.push(message) },
      reload: () =>
        runTest(
          Effect.sync(() => {
            reloads += 1;
          }),
        ),
    } as unknown as ExtensionCommandContext;
    return { ctx, notes, reloads: () => reloads };
  };

  it("completes kinds, then the kind's actions and account names", () =>
    runTest(
      Effect.gen(function* () {
        yield* writeAccounts([{ name: "main" }, { name: "sub" }]);
        const complete = command().getArgumentCompletions!;
        expect((yield* awaited(complete("cl")))?.map((item) => item.value)).toEqual(["claude "]);
        expect((yield* awaited(complete("claude lo")))?.map((item) => item.value)).toEqual([
          "claude login ",
          "claude logout ",
        ]);
        expect((yield* awaited(complete("claude use s")))?.map((item) => item.value)).toEqual([
          "claude use sub",
        ]);
      }),
    ));

  it("routes to the kind and reloads when the account list changes", () =>
    runTest(
      Effect.gen(function* () {
        const { ctx, notes, reloads } = context();
        yield* awaited(command().handler("claude add token printf tok", ctx));
        expect(loadAccounts().map((account) => account.name)).toEqual(["default", "token"]);
        expect(reloads()).toBe(1);
        yield* awaited(command().handler("", ctx));
        expect(notes.at(-1)).toMatch(/^claude:\n1\. default .*\n2\. token /u);
        yield* awaited(command().handler("nope", ctx));
        expect(notes.at(-1)).toMatch(/Unknown account kind "nope"/u);
      }).pipe(withEnv({ CLAUDE_BIN: "/bin/false" })),
    ));
});

describe("opencode-free provider", () => {
  const register = (): ProviderConfig => {
    let config: ProviderConfig | undefined;
    registerOpenCode({
      registerProvider: (_id: string, input: ProviderConfig) => {
        config = input;
      },
    } as unknown as ExtensionAPI);
    if (config === undefined) throw new Error("provider not registered");
    return config;
  };

  const run = (script: string): Effect.Effect<AssistantMessageEvent[], StreamFailure> =>
    Effect.gen(function* () {
      const bin = joinPath(dir, "opencode");
      yield* writeTextFile(bin, `#!/bin/sh\ncat > "${dir}/stdin.txt"\n${script}\n`);
      yield* changeMode(bin, 0o755);
      yield* Effect.sync(() => writeEnv("OPENCODE_BIN", bin));
      const config = register();
      const model = {
        ...config.models![0]!,
        provider: "opencode-free",
        api: "openai-completions" as const,
      };
      const context = {
        messages: [{ role: "user", content: "hello", timestamp: 0 }],
      } as unknown as TranscriptContext;
      const stream = (
        config.streamSimple as (
          m: Model<string>,
          c: TranscriptContext,
        ) => AsyncIterable<AssistantMessageEvent>
      )(model as unknown as Model<string>, context);
      return Array.from(
        yield* Stream.runCollect(
          Stream.fromAsyncIterable(stream, (cause) => new StreamFailure({ cause })),
        ),
      );
    });

  it("streams the CLI's text and usage as the reply", () =>
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
        expect(done.message.content).toEqual([{ type: "text" as const, text: "Hi there" }]);
        expect(done.message.usage).toMatchObject({
          input: 5,
          output: 2,
          cacheRead: 1,
          totalTokens: 8,
        });
      }),
    ));

  it("reports an error event as a failed reply even when the CLI exits 0", () =>
    runTest(
      Effect.gen(function* () {
        const events = yield* run(`echo '{"type":"error","error":{"message":"quota exceeded"}}'`);
        const last = events.at(-1);
        expect(last?.type).toBe("error");
        if (last?.type !== "error") return;
        expect(last.error.errorMessage).toBe("quota exceeded");
      }),
    ));
});
