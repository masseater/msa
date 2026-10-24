import testing from "@msa/testing";
import { Effect } from "effect";

import orchestratorCallbacks from "../src/core/agent-session/orchestrator-callbacks.ts";
import type orchestratorTypes from "../src/core/orchestrator/orchestrator.types.ts";

const { encodeJson } = testing;
const { runCommand } = orchestratorCallbacks;

type Ci = "pending" | "success" | "failure";

interface FakePull {
  number: number;
  branch: string;
  base: string;
  state: "OPEN" | "MERGED" | "CLOSED";
  head: string;
}

function git(origin: string, args: string): Effect.Effect<{ ok: boolean; output: string }> {
  return Effect.map(
    Effect.promise((signal) => runCommand(`git -C ${origin} ${args}`, origin, 30_000, signal)),
    (result) => ({ ok: result.exitCode === 0, output: result.output.trim() }),
  );
}

function ok(stdout: string): orchestratorTypes.GhResult {
  return { code: 0, stderr: "", stdout };
}

function refused(stderr: string): orchestratorTypes.GhResult {
  return { code: 1, stderr, stdout: "" };
}

export default class FakeGitHub {
  readonly pulls: FakePull[] = [];
  readonly ci = new Map<string, Ci>();
  readonly conflicting = new Set<number>();
  readonly merged: { number: number; sha: string }[] = [];
  readonly origin: string;

  constructor(origin: string) {
    this.origin = origin;
  }

  open(branch: string, base = "main"): Effect.Effect<number> {
    return Effect.gen({ self: this }, function* () {
      const head = yield* git(this.origin, `rev-parse refs/heads/${branch}`);
      if (!head.ok) throw new Error(`${branch} is not pushed to the fake origin`);
      const number = this.pulls.length + 1;
      this.pulls.push({ base, branch, head: head.output, number, state: "OPEN" });
      return number;
    });
  }

  head(branch: string): Effect.Effect<string> {
    return Effect.map(
      git(this.origin, `rev-parse refs/heads/${branch}`),
      (result) => result.output,
    );
  }

  runGh = (args: readonly string[], _cwd: string): Promise<orchestratorTypes.GhResult> =>
    Effect.runPromise(this.handle(args));

  private handle(args: readonly string[]): Effect.Effect<orchestratorTypes.GhResult> {
    return Effect.gen({ self: this }, function* () {
      const [group, command, target] = args;
      if (group !== "pr") return refused(`fake gh does not know ${args.join(" ")}`);
      if (command === "list") {
        const branch = args[args.indexOf("--head") + 1];
        const views = yield* Effect.forEach(
          this.pulls.filter((pull) => pull.branch === branch),
          (pull) => this.view(pull),
        );
        return ok(yield* Effect.orDie(encodeJson(views)));
      }
      const pull = this.pulls.find((candidate) => String(candidate.number) === target);
      if (pull === undefined) return refused(`no pull requests found for ${target}`);
      if (command === "view") return ok(yield* Effect.orDie(encodeJson(yield* this.view(pull))));
      if (command === "merge")
        return yield* this.merge(pull, args[args.indexOf("--match-head-commit") + 1] ?? "");
      return refused(`fake gh does not know pr ${command}`);
    });
  }

  private refresh(pull: FakePull): Effect.Effect<void> {
    return Effect.gen({ self: this }, function* () {
      if (pull.state !== "OPEN") return;
      const head = yield* git(this.origin, `rev-parse refs/heads/${pull.branch}`);
      if (head.ok) pull.head = head.output;
    });
  }

  private behind(pull: FakePull): Effect.Effect<boolean> {
    return Effect.map(
      git(this.origin, `merge-base --is-ancestor refs/heads/${pull.base} ${pull.head}`),
      (result) => !result.ok,
    );
  }

  private view(pull: FakePull) {
    return Effect.gen({ self: this }, function* () {
      yield* this.refresh(pull);
      const ci = this.ci.get(pull.head);
      const conflicting = this.conflicting.has(pull.number);
      const behind = pull.state === "OPEN" && (yield* this.behind(pull));
      return {
        baseRefName: pull.base,
        headRefName: pull.branch,
        headRefOid: pull.head,
        mergeStateStatus: conflicting ? "DIRTY" : behind ? "BEHIND" : "CLEAN",
        mergeable: conflicting ? "CONFLICTING" : "MERGEABLE",
        number: pull.number,
        state: pull.state,
        statusCheckRollup:
          ci === undefined
            ? []
            : [
                {
                  __typename: "CheckRun",
                  conclusion: ci === "pending" ? null : ci.toUpperCase(),
                  name: "verify",
                  status: ci === "pending" ? "IN_PROGRESS" : "COMPLETED",
                },
              ],
        url: `https://github.invalid/pull/${pull.number}`,
      };
    });
  }

  private merge(pull: FakePull, sha: string): Effect.Effect<orchestratorTypes.GhResult> {
    return Effect.gen({ self: this }, function* () {
      yield* this.refresh(pull);
      if (pull.state !== "OPEN") return refused(`pull request #${pull.number} is not open`);
      if (pull.head !== sha)
        return refused("Head branch was modified. Review and try the merge again.");
      if (yield* this.behind(pull))
        return refused("the head branch is not up to date with the base branch");
      if (this.ci.get(pull.head) !== "success")
        return refused("required status checks have not passed");
      const commit = yield* git(
        this.origin,
        `-c user.name=t -c user.email=t@example.invalid commit-tree -m "pull #${pull.number}" -p refs/heads/${pull.base} ${pull.head}^{tree}`,
      );
      yield* git(this.origin, `update-ref refs/heads/${pull.base} ${commit.output}`);
      pull.state = "MERGED";
      this.merged.push({ number: pull.number, sha });
      return ok("");
    });
  }
}
