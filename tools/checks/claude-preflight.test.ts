import { NodeServices } from "@effect/platform-node";
import { Config, Effect, FileSystem, Layer, ManagedRuntime, Path, Schema } from "effect";
import { expect, it } from "vite-plus/test";
import { parse } from "yaml";

import captureProcessModule from "../capture-process.ts";

const { captureProcess, processRunnerLayer } = captureProcessModule;

const SCRIPT = ".github/scripts/claude-preflight.sh";
const TOKEN_SECRET = "${{ secrets.CLAUDE_CODE_OAUTH_TOKEN }}";
const LIMIT = "You've hit your weekly limit · resets 6am (UTC)";

const Step = Schema.Struct({
  env: Schema.optional(Schema.Record(Schema.String, Schema.String)),
  run: Schema.optional(Schema.String),
  uses: Schema.optional(Schema.String),
  with: Schema.optional(Schema.Record(Schema.String, Schema.Unknown)),
});
const Workflow = Schema.Struct({
  jobs: Schema.Struct({ autofix: Schema.Struct({ steps: Schema.Array(Step) }) }),
});

const ResultJson = Schema.fromJsonString(
  Schema.Struct({
    api_error_status: Schema.NullOr(Schema.Finite),
    is_error: Schema.Boolean,
    result: Schema.String,
  }),
);

const runtime = ManagedRuntime.make(Layer.mergeAll(NodeServices.layer, processRunnerLayer));

const FAKE_CLAUDE = (dir: string) =>
  ["#!/bin/sh", `: > "${dir}/called"`, `cat "${dir}/output"`, ""].join("\n");

const preflight = (token: string, output: string) =>
  Effect.gen(function* () {
    const fs = yield* FileSystem.FileSystem;
    const path = yield* Path.Path;
    const root = path.resolve(import.meta.dirname, "../..");
    const bin = yield* fs.makeTempDirectoryScoped({ prefix: "msa-claude-preflight-" });
    yield* fs.writeFileString(path.join(bin, "output"), output);
    yield* fs.writeFileString(path.join(bin, "claude"), FAKE_CLAUDE(bin), { mode: 0o755 });
    const inherited = yield* Config.String("PATH").pipe(Config.withDefault(""));
    const result = yield* captureProcess({
      args: [],
      command: path.join(root, SCRIPT),
      cwd: root,
      env: { CLAUDE_CODE_OAUTH_TOKEN: token, PATH: `${bin}:${inherited}` },
    });
    return { ...result, called: yield* fs.exists(path.join(bin, "called")) };
  }).pipe(Effect.scoped);

const answer = (status: number | null, result: string) =>
  Schema.encodeEffect(ResultJson)({
    api_error_status: status,
    is_error: status !== null,
    result,
  });

it("checks the token the Claude step uses before any other step after the checkout", () =>
  runtime.runPromise(
    Effect.gen(function* () {
      const fs = yield* FileSystem.FileSystem;
      const path = yield* Path.Path;
      const file = path.resolve(import.meta.dirname, "../../.github/workflows/autofix.yml");
      const { steps } = (yield* Schema.decodeUnknownEffect(Workflow)(
        parse(yield* fs.readFileString(file)),
      )).jobs.autofix;
      const claude = steps.find((step) => step.uses?.startsWith("anthropics/claude-code-action@"));
      expect(claude?.with?.["claude_code_oauth_token"]).toBe(TOKEN_SECRET);
      expect(steps[0]?.uses).toMatch(/^actions\/checkout@/u);
      expect(steps[1]?.run).toBe(SCRIPT);
      expect(steps[1]?.env?.["CLAUDE_CODE_OAUTH_TOKEN"]).toBe(TOKEN_SECRET);
    }),
  ));

it("fails with an explicit error when the token secret is empty, without calling Claude", () =>
  runtime.runPromise(
    Effect.gen(function* () {
      const result = yield* preflight("", yield* answer(null, "ok"));
      expect(result.exitCode).toBe(1);
      expect(result.stdout).toContain("::error::The CLAUDE_CODE_OAUTH_TOKEN secret is empty.");
      expect(result.called).toBe(false);
    }),
  ));

it("passes when Claude Code answers with the token", () =>
  runtime.runPromise(
    Effect.gen(function* () {
      const result = yield* preflight("sk-ant-oat01-x", yield* answer(null, "Ready."));
      expect(result.exitCode, result.stdout + result.stderr).toBe(0);
      expect(result.stdout).not.toContain("::error::");
    }),
  ));

it("tells a rejected token from an exhausted subscription", () =>
  runtime.runPromise(
    Effect.gen(function* () {
      const rejected = yield* preflight(
        "sk-ant-oat01-x",
        yield* answer(401, "Failed to authenticate. API Error: 401 OAuth access token is invalid."),
      );
      expect(rejected.exitCode).toBe(1);
      expect(rejected.stdout).toContain("::error::Anthropic rejected CLAUDE_CODE_OAUTH_TOKEN:");

      const exhausted = yield* preflight("sk-ant-oat01-x", yield* answer(429, LIMIT));
      expect(exhausted.exitCode).toBe(1);
      expect(exhausted.stdout).toContain("::error::CLAUDE_CODE_OAUTH_TOKEN authenticated, but");
      expect(exhausted.stdout).toContain(LIMIT);
    }),
  ));

it("fails when Claude Code prints no result", () =>
  runtime.runPromise(
    Effect.gen(function* () {
      const result = yield* preflight("sk-ant-oat01-x", "Segmentation fault\n");
      expect(result.exitCode).toBe(1);
      expect(result.stdout).toContain("::error::Claude Code did not answer");
    }),
  ));
