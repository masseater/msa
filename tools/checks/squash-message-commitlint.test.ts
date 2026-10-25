import { NodeServices } from "@effect/platform-node";
import { Config, Effect, FileSystem, Layer, ManagedRuntime, Path, Schema } from "effect";
import { expect, it } from "vite-plus/test";
import { parse } from "yaml";

import captureProcessModule from "../capture-process.ts";

const { captureProcess, processRunnerLayer } = captureProcessModule;

const TITLE = "fix(orchestrator): squash with the commit bodies";
const FIRST = "a".repeat(40);
const SECOND = "b".repeat(40);

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
const PullJson = Schema.fromJsonString(Schema.Struct({ title: Schema.String }));

type Pages = typeof PullCommitPages.Type;

const commit = (sha: string, message: string) => ({ commit: { message }, sha });

const runtime = ManagedRuntime.make(Layer.mergeAll(NodeServices.layer, processRunnerLayer));

const FAKE_GH = (dir: string) =>
  [
    "#!/bin/sh",
    `printf '%s\\n' "$*" >> "${dir}/calls.txt"`,
    'case "$1 $2" in',
    `  "api "*) cat "${dir}/commits.json" ;;`,
    `  "pr view") cat "${dir}/pull.json" ;;`,
    "  *) exit 1 ;;",
    "esac",
    "",
  ].join("\n");

const pullRequestRun = Effect.gen(function* () {
  const fs = yield* FileSystem.FileSystem;
  const path = yield* Path.Path;
  const file = path.resolve(import.meta.dirname, "../../.github/workflows/commits.yml");
  const workflow = yield* Schema.decodeUnknownEffect(Workflow)(
    parse(yield* fs.readFileString(file)),
  );
  const step = workflow.jobs.commits.steps.find(
    (candidate) => candidate.if === "github.event_name == 'pull_request'",
  );
  return (step?.run ?? "").split("\n");
});

const squashLine = Effect.map(pullRequestRun, (lines) =>
  lines.find((line) => line.includes(" squash-message ")),
);

const lint = (pages: Pages, head: string) =>
  Effect.gen(function* () {
    const fs = yield* FileSystem.FileSystem;
    const path = yield* Path.Path;
    const root = path.resolve(import.meta.dirname, "../..");
    const bin = yield* fs.makeTempDirectoryScoped({ prefix: "msa-squash-message-" });
    yield* fs.writeFileString(
      path.join(bin, "commits.json"),
      yield* Schema.encodeEffect(PullCommitPages)(pages),
    );
    yield* fs.writeFileString(
      path.join(bin, "pull.json"),
      yield* Schema.encodeEffect(PullJson)({ title: TITLE }),
    );
    yield* fs.writeFileString(path.join(bin, "calls.txt"), "");
    yield* fs.writeFileString(path.join(bin, "gh"), FAKE_GH(bin), { mode: 0o755 });
    const inherited = yield* Config.String("PATH").pipe(Config.withDefault(""));
    const line = (yield* squashLine) ?? "exit 99";
    const result = yield* captureProcess({
      args: ["-eo", "pipefail", "-c", line],
      command: "bash",
      cwd: root,
      env: {
        HEAD_SHA: head,
        PATH: `${bin}:${path.join(root, "node_modules/.bin")}:${inherited}`,
        PR_NUMBER: "7",
      },
    });
    return { ...result, calls: (yield* fs.readFileString(path.join(bin, "calls.txt"))).trim() };
  }).pipe(Effect.scoped);

it("lints, in the commits job, the message msa squash-message builds at the tested head", () =>
  runtime.runPromise(
    Effect.gen(function* () {
      const lines = yield* pullRequestRun;
      expect(lines).toContain('HEAD_SHA="$(git rev-parse HEAD^2)"');
      expect(yield* squashLine).toMatch(
        /apps\/coding-agent\/src\/cli\.ts squash-message "\$PR_NUMBER" "\$HEAD_SHA" \| vp exec commitlint --verbose$/u,
      );
    }),
  ));

it("passes the squash message built from the commits even when a pull request body would not", () =>
  runtime.runPromise(
    Effect.gen(function* () {
      const result = yield* lint(
        [
          [
            commit(FIRST, "fix(orchestrator): read the commits\n\nThe harness reads the commits."),
            commit(SECOND, "test: pin the squash message\n\n- one bullet\n- another bullet"),
          ],
        ],
        SECOND,
      );
      expect(result.exitCode, result.stdout + result.stderr).toBe(0);
      expect(result.stdout).toContain(`${TITLE} (#7)`);
      expect(result.calls).toContain("api --paginate --slurp repos/{owner}/{repo}/pulls/7/commits");
    }),
  ));

it("fails when a commit body has a line over 100 characters", () =>
  runtime.runPromise(
    Effect.gen(function* () {
      const result = yield* lint(
        [[commit(FIRST, `fix(orchestrator): read the commits\n\n| table | ${"x".repeat(120)} |`)]],
        FIRST,
      );
      expect(result.exitCode).not.toBe(0);
      expect(result.stdout + result.stderr).toContain("body-max-line-length");
    }),
  ));

it("fails when GitHub lists the commits up to another head than the tested one", () =>
  runtime.runPromise(
    Effect.gen(function* () {
      const result = yield* lint(
        [[commit(FIRST, "fix(orchestrator): read the commits"), commit(SECOND, "test: pin it")]],
        FIRST,
      );
      expect(result.exitCode).not.toBe(0);
      expect(result.stdout + result.stderr).toContain(`up to ${SECOND}, not ${FIRST}`);
    }),
  ));
