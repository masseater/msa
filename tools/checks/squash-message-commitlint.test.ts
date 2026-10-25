import { NodeServices } from "@effect/platform-node";
import { Config, Effect, FileSystem, Layer, ManagedRuntime, Path, Schema } from "effect";
import { expect, it } from "vite-plus/test";
import { parse } from "yaml";

import captureProcessModule from "../capture-process.ts";

const { captureProcess, processRunnerLayer } = captureProcessModule;

const SCRIPT = "scripts/lint-squash-message.sh";
const TITLE = "fix(orchestrator): squash with the commit bodies";

const Step = Schema.Struct({
  if: Schema.optional(Schema.String),
  run: Schema.optional(Schema.String),
});
const Workflow = Schema.Struct({
  jobs: Schema.Struct({ commits: Schema.Struct({ steps: Schema.Array(Step) }) }),
});

const PullCommitPages = Schema.Struct({
  commit: Schema.Struct({ message: Schema.String }),
  sha: Schema.String,
}).pipe(Schema.Array, Schema.Array, Schema.fromJsonString);

type Pages = typeof PullCommitPages.Type;

const commit = (sha: string, message: string) => ({ commit: { message }, sha });

const runtime = ManagedRuntime.make(Layer.mergeAll(NodeServices.layer, processRunnerLayer));

const lint = (pages: Pages) =>
  Effect.gen(function* () {
    const fs = yield* FileSystem.FileSystem;
    const path = yield* Path.Path;
    const root = path.resolve(import.meta.dirname, "../..");
    const bin = yield* fs.makeTempDirectoryScoped({ prefix: "msa-squash-message-" });
    const commits = path.join(bin, "commits.json");
    const calls = path.join(bin, "calls.txt");
    yield* fs.writeFileString(commits, yield* Schema.encodeEffect(PullCommitPages)(pages));
    const inherited = yield* Config.String("PATH").pipe(Config.withDefault(""));
    yield* fs.writeFileString(
      path.join(bin, "gh"),
      `#!/bin/sh\nprintf '%s\\n' "$*" >> "${calls}"\ncat "${commits}"\n`,
      { mode: 0o755 },
    );
    const result = yield* captureProcess({
      args: ["7", TITLE],
      command: path.join(root, SCRIPT),
      cwd: root,
      env: { PATH: `${bin}:${path.join(root, "node_modules/.bin")}:${inherited}` },
    });
    return { ...result, calls: (yield* fs.readFileString(calls)).trim() };
  }).pipe(Effect.scoped);

it(`runs ${SCRIPT} with the pull request number and title in the commits job of pull requests`, () =>
  runtime.runPromise(
    Effect.gen(function* () {
      const fs = yield* FileSystem.FileSystem;
      const path = yield* Path.Path;
      const file = path.resolve(import.meta.dirname, "../../.github/workflows/commits.yml");
      const workflow = yield* Schema.decodeUnknownEffect(Workflow)(
        parse(yield* fs.readFileString(file)),
      );
      const step = workflow.jobs.commits.steps.find(
        (candidate) => candidate.if === "github.event_name == 'pull_request'",
      );
      expect(step?.run?.split("\n")).toContain(`${SCRIPT} "$PR_NUMBER" "$PR_TITLE"`);
    }),
  ));

it("passes the squash message built from the commits even when a pull request body would not", () =>
  runtime.runPromise(
    Effect.gen(function* () {
      const result = yield* lint([
        [
          commit("a1", "fix(orchestrator): read the commits\n\nThe harness reads the commits."),
          commit("b2", "test: pin the squash message\n\n- one bullet\n- another bullet"),
        ],
      ]);
      expect(result.exitCode, result.stdout + result.stderr).toBe(0);
      expect(result.stdout).toContain(`${TITLE} (#7)`);
      expect(result.calls).toBe("api --paginate --slurp repos/{owner}/{repo}/pulls/7/commits");
    }),
  ));

it("fails when a commit body has a line over 100 characters", () =>
  runtime.runPromise(
    Effect.gen(function* () {
      const result = yield* lint([
        [commit("a1", `fix(orchestrator): read the commits\n\n| table | ${"x".repeat(120)} |`)],
      ]);
      expect(result.exitCode).not.toBe(0);
      expect(result.stdout + result.stderr).toContain("body-max-line-length");
    }),
  ));
