import testing from "@msa/testing";
import { Effect } from "effect";
import { expect, it } from "vite-plus/test";

import orchestratorHarness from "./orchestrator-harness.ts";
import orchestratorSupport from "./orchestrator-support.ts";
import pullRequestSupport from "./pull-request-support.ts";
import worktreeSupport from "./worktree-support.ts";

const { joinPath, writeTextFile } = testing;
const { create } = orchestratorSupport;
const { setup, taskStatus, waitFor } = orchestratorHarness.harness;
const { GIT, runCommand, sh, shortId } = worktreeSupport;
const { withRemote } = pullRequestSupport;

const ROOT = joinPath(import.meta.dirname, "..", "..", "..");
const LONG_LINE = `| table | ${"x".repeat(150)} |`;

const FIRST = [
  "feat: add feature.txt",
  "",
  "feature.txt holds the feature flag the app reads at startup.",
].join("\n");

const SECOND = ["test: cover feature.txt", "", "The check reads feature.txt back."].join("\n");

function commitlint(message: string, cwd: string) {
  return Effect.gen(function* () {
    const file = joinPath(cwd, "squash-message.txt");
    yield* writeTextFile(file, message);
    return yield* Effect.promise((signal) =>
      runCommand(
        `${joinPath(ROOT, "node_modules", ".bin", "commitlint")} --cwd ${ROOT} --edit ${file}`,
        ROOT,
        60_000,
        signal,
      ),
    );
  });
}

const squashesWithTheCommitBodies = () =>
  Effect.runPromise(
    withRemote(({ github, repository }) =>
      Effect.gen(function* () {
        const run = setup({ cwd: repository, runCommand, runGh: github.runGh });
        const task = yield* create(run.orchestrator, {
          currentState: "feature.txt is missing",
          goalState: "feature.txt exists on main",
          title: "feature",
        });
        const branch = `task/${shortId(task.id)}`;
        const worktree = run.workers[0]!.cwd;
        yield* writeTextFile(joinPath(worktree, "first.msg"), FIRST);
        yield* writeTextFile(joinPath(worktree, "second.msg"), SECOND);
        yield* sh(
          [
            "echo on > feature.txt && git add feature.txt",
            `${GIT} commit -q -F first.msg`,
            "echo check > check.txt && git add check.txt",
            `${GIT} commit -q -F second.msg`,
            "rm first.msg second.msg",
            `git push -q origin ${branch}`,
          ].join(" && "),
          worktree,
        );
        const number = yield* github.open(branch, "main", `## Summary\n\n${LONG_LINE}\n`);
        github.pulls[0]!.title = "feat: add the feature flag";
        github.ci.set(yield* github.head(branch), "success");

        run.workers[0]!.complete("opened");
        yield* waitFor(() => run.workers.length === 2);
        run.workers[1]!.complete("acceptable");
        yield* waitFor(() => taskStatus(run.orchestrator, task.id) === "completed");

        const [merged] = github.merged;
        expect(merged?.subject).toBe(`feat: add the feature flag (#${number})`);
        expect(merged?.body).toBe(`${FIRST}\n\n${SECOND}`);
        const lint = yield* commitlint(`${merged?.subject}\n\n${merged?.body}\n`, repository);
        expect(lint.exitCode, lint.output).toBe(0);

        const withPullBody = yield* commitlint(
          `${merged?.subject}\n\n${github.pulls[0]!.body}`,
          repository,
        );
        expect(withPullBody.output).toContain("body-max-line-length");
        expect(withPullBody.exitCode).not.toBe(0);
      }),
    ),
  );

it(
  "squash-merges with the reviewed title and the bodies of the pull request's commits, not its body, so a body line over 100 characters still passes commitlint",
  squashesWithTheCommitBodies,
);
