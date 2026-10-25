import { NodeServices } from "@effect/platform-node";
import { Config, Effect, FileSystem, Layer, ManagedRuntime, Path, Schema } from "effect";
import { expect, it } from "vite-plus/test";
import { parse } from "yaml";

import captureProcessModule from "../capture-process.ts";

const { captureProcess, processRunnerLayer } = captureProcessModule;

const LINT = "scripts/lint-squash-message.sh";
const MERGE = "scripts/squash-message.ts merge";
const TITLE = "fix(orchestrator): squash with the commit bodies";
const LONG_SUBJECT = `fix(orchestrator): ${"x".repeat(80)}`;

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
    `  "api --method") for arg in "$@"; do printf '%s\\0' "$arg"; done > "${dir}/merge.txt"; printf '{"merged":true,"sha":"m1"}' ;;`,
    `  "api "*) cat "${dir}/commits.json" ;;`,
    `  "pr view") cat "${dir}/pull.json" ;;`,
    "esac",
    "",
  ].join("\n");

const withFakeGh = (pages: Pages, command: string, args: readonly string[]) =>
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
    yield* fs.writeFileString(path.join(bin, "merge.txt"), "");
    yield* fs.writeFileString(path.join(bin, "gh"), FAKE_GH(bin), { mode: 0o755 });
    const inherited = yield* Config.String("PATH").pipe(Config.withDefault(""));
    const result = yield* captureProcess({
      args,
      command,
      cwd: root,
      env: { PATH: `${bin}:${path.join(root, "node_modules/.bin")}:${inherited}` },
    });
    const merged = (yield* fs.readFileString(path.join(bin, "merge.txt"))).split("\0");
    return {
      ...result,
      calls: (yield* fs.readFileString(path.join(bin, "calls.txt"))).trim(),
      merged,
    };
  }).pipe(Effect.scoped);

const lint = (pages: Pages, head: string) =>
  Effect.gen(function* () {
    const path = yield* Path.Path;
    return yield* withFakeGh(pages, path.resolve(import.meta.dirname, "../..", LINT), [
      "7",
      TITLE,
      head,
    ]);
  });

const commitlint = (message: string) =>
  Effect.gen(function* () {
    const fs = yield* FileSystem.FileSystem;
    const path = yield* Path.Path;
    const root = path.resolve(import.meta.dirname, "../..");
    const dir = yield* fs.makeTempDirectoryScoped({ prefix: "msa-squash-commitlint-" });
    const file = path.join(dir, "message.txt");
    yield* fs.writeFileString(file, message);
    return yield* captureProcess({
      args: ["--edit", file],
      command: path.join(root, "node_modules/.bin/commitlint"),
      cwd: root,
    });
  }).pipe(Effect.scoped);

const fieldOf = (args: readonly string[], key: string) =>
  args
    .find((arg, index) => args[index - 1] === "-f" && arg.startsWith(`${key}=`))
    ?.slice(key.length + 1);

it(`runs ${LINT} with the number, title and tested head of the pull request in the commits job`, () =>
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
      expect(step?.run?.split("\n")).toContain(
        `${LINT} "$PR_NUMBER" "$PR_TITLE" "$(git rev-parse HEAD^2)"`,
      );
    }),
  ));

it("passes the squash message built from the commits even when a pull request body would not", () =>
  runtime.runPromise(
    Effect.gen(function* () {
      const result = yield* lint(
        [
          [
            commit("a1", "fix(orchestrator): read the commits\n\nThe harness reads the commits."),
            commit("b2", "test: pin the squash message\n\n- one bullet\n- another bullet"),
          ],
        ],
        "b2",
      );
      expect(result.exitCode, result.stdout + result.stderr).toBe(0);
      expect(result.stdout).toContain(`${TITLE} (#7)`);
      expect(result.calls).toBe("api --paginate --slurp repos/{owner}/{repo}/pulls/7/commits");
    }),
  ));

it("fails when a commit body has a line over 100 characters", () =>
  runtime.runPromise(
    Effect.gen(function* () {
      const result = yield* lint(
        [[commit("a1", `fix(orchestrator): read the commits\n\n| table | ${"x".repeat(120)} |`)]],
        "a1",
      );
      expect(result.exitCode).not.toBe(0);
      expect(result.stdout + result.stderr).toContain("body-max-line-length");
    }),
  ));

it("fails when GitHub lists the commits up to another head than the tested one", () =>
  runtime.runPromise(
    Effect.gen(function* () {
      const result = yield* lint(
        [[commit("a1", "fix(orchestrator): read the commits"), commit("b2", "test: pin it")]],
        "a1",
      );
      expect(result.exitCode).not.toBe(0);
      expect(result.stdout + result.stderr).toContain("up to b2, not a1");
    }),
  ));

it(`${MERGE} squash-merges at the given head with the message GitHub's default message would fail`, () =>
  runtime.runPromise(
    Effect.gen(function* () {
      const path = yield* Path.Path;
      const root = path.resolve(import.meta.dirname, "../..");
      const first = `${LONG_SUBJECT}\n\nThe first commit.`;
      const second = "test: pin it\n\nThe second commit.";
      const result = yield* withFakeGh([[commit("a1", first), commit("b2", second)]], "node", [
        path.join(root, "scripts/squash-message.ts"),
        "merge",
        "7",
        "b2",
      ]);
      expect(result.exitCode, result.stderr).toBe(0);
      expect(result.merged.slice(0, 4)).toEqual([
        "api",
        "--method",
        "PUT",
        "repos/{owner}/{repo}/pulls/7/merge",
      ]);
      expect(fieldOf(result.merged, "merge_method")).toBe("squash");
      expect(fieldOf(result.merged, "sha")).toBe("b2");
      const subject = fieldOf(result.merged, "commit_title");
      const body = fieldOf(result.merged, "commit_message");
      expect(subject).toBe(`${TITLE} (#7)`);
      expect(body).toBe(`${first}\n\n${second}`);
      const ours = yield* commitlint(`${subject}\n\n${body}\n`);
      expect(ours.exitCode, ours.stdout + ours.stderr).toBe(0);

      const githubDefault = yield* commitlint(`${subject}\n\n* ${first}\n\n* ${second}\n`);
      expect(githubDefault.stdout + githubDefault.stderr).toContain("body-max-line-length");
      expect(githubDefault.exitCode).not.toBe(0);
    }),
  ));

it(`${MERGE} does not merge when GitHub lists the commits up to another head`, () =>
  runtime.runPromise(
    Effect.gen(function* () {
      const path = yield* Path.Path;
      const root = path.resolve(import.meta.dirname, "../..");
      const result = yield* withFakeGh(
        [[commit("a1", "fix: one"), commit("b2", "fix: two")]],
        "node",
        [path.join(root, "scripts/squash-message.ts"), "merge", "7", "a1"],
      );
      expect(result.exitCode).not.toBe(0);
      expect(result.merged).toEqual([""]);
    }),
  ));
