import testing from "@msa/testing";
import { DateTime, Effect } from "effect";

import orchestratorCallbacks from "../src/core/agent-session/orchestrator-callbacks.ts";
import type orchestratorTypes from "../src/core/orchestrator/orchestrator.types.ts";
import fakeGitHubMerge from "./fake-github-merge.ts";

const { encodeJson } = testing;
const { runCommand } = orchestratorCallbacks;
const { commitOf, mergeRequestOf, ok, refused } = fakeGitHubMerge;

type Ci = "pending" | "success" | "failure" | "cancelled";

interface FakePull {
  number: number;
  branch: string;
  base: string;
  state: "OPEN" | "MERGED" | "CLOSED";
  head: string;
  mergedBy?: { login: string; commit: string; at: string };
  autoMergeBy?: string;
  title: string;
  body: string;
}

interface Merged {
  number: number;
  sha: string;
  subject: string;
  body: string;
}

function git(origin: string, args: string): Effect.Effect<{ ok: boolean; output: string }> {
  return Effect.map(
    Effect.promise((signal) => runCommand(`git -C ${origin} ${args}`, origin, 30_000, signal)),
    (result) => ({ ok: result.exitCode === 0, output: result.output.trim() }),
  );
}

const VERIFY = { __typename: "CheckRun", name: "verify", workflowName: "verify" };

export default class FakeGitHub {
  readonly pulls: FakePull[] = [];
  readonly ci = new Map<string, Ci>();
  readonly conflicting = new Set<number>();
  readonly rerun = new Set<string>();
  readonly merged: Merged[] = [];
  readonly requests: { number: string | undefined; sha: string }[] = [];
  readonly origin: string;

  unavailable: orchestratorTypes.GhResult | undefined;
  beforeMerge: Effect.Effect<void> | undefined;
  afterMerge: Effect.Effect<void> | undefined;
  mergeAnswer: orchestratorTypes.GhResult | undefined;
  mergeRefusal: orchestratorTypes.GhResult | undefined;
  commitRefusal: orchestratorTypes.GhResult | undefined;
  readonly messages = new Map<string, string>();
  calls = 0;
  answered = 0;
  private held: Promise<void> | undefined;
  private releaseHeld: (() => void) | undefined;

  constructor(origin: string) {
    this.origin = origin;
  }

  open(branch: string, base = "main", body = `Adds ${branch}.`): Effect.Effect<number> {
    return Effect.gen({ self: this }, function* () {
      const head = yield* git(this.origin, `rev-parse refs/heads/${branch}`);
      if (!head.ok) throw new Error(`${branch} is not pushed to the fake origin`);
      const number = this.pulls.length + 1;
      this.pulls.push({
        base,
        body,
        branch,
        head: head.output,
        number,
        state: "OPEN",
        title: `Add ${branch}`,
      });
      return number;
    });
  }

  head(branch: string): Effect.Effect<string> {
    return Effect.map(
      git(this.origin, `rev-parse refs/heads/${branch}`),
      (result) => result.output,
    );
  }

  hold(): void {
    const { promise, resolve } = Promise.withResolvers<void>();
    this.held = promise;
    this.releaseHeld = resolve;
  }

  release(): void {
    this.held = undefined;
    this.releaseHeld?.();
  }

  runGh = (args: readonly string[], _cwd: string): Promise<orchestratorTypes.GhResult> => {
    this.calls += 1;
    const held = this.held;
    return Effect.runPromise(
      Effect.gen({ self: this }, function* () {
        if (held !== undefined) yield* Effect.promise(() => held);
        const result = yield* this.handle(args);
        this.answered += 1;
        return result;
      }),
    );
  };

  private handle(args: readonly string[]): Effect.Effect<orchestratorTypes.GhResult> {
    return Effect.gen({ self: this }, function* () {
      if (this.unavailable !== undefined) return this.unavailable;
      const [group, command, target] = args;
      if (group === "api" && args.includes("PUT")) return yield* this.mergeRequest(args);
      if (group === "api" && /\/commits\/[0-9a-f]+$/u.test(command ?? "")) {
        return yield* commitOf(this.messages, this.commitRefusal, command ?? "");
      }
      if (group === "api") return yield* this.commits(args);
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
      if (command === "view" && args.join(" ").includes("mergedBy")) {
        const by = pull.mergedBy;
        return ok(
          yield* Effect.orDie(
            encodeJson({
              mergeCommit: by === undefined ? null : { oid: by.commit },
              mergedAt: by === undefined ? null : by.at,
              mergedBy: by === undefined ? null : { login: by.login },
            }),
          ),
        );
      }
      if (command === "view") return ok(yield* Effect.orDie(encodeJson(yield* this.view(pull))));
      return refused(`fake gh does not know pr ${command}`);
    });
  }

  private commits(args: readonly string[]): Effect.Effect<orchestratorTypes.GhResult> {
    return Effect.gen({ self: this }, function* () {
      const number = /^repos\/\{owner\}\/\{repo\}\/pulls\/(\d+)\/commits$/u.exec(
        args.at(-1) ?? "",
      )?.[1];
      const pull = this.pulls.find((candidate) => String(candidate.number) === number);
      if (pull === undefined) return refused(`fake gh does not know ${args.join(" ")}`);
      yield* this.refresh(pull);
      const log = yield* git(
        this.origin,
        `log --reverse --format=%H%x1f%B%x1e refs/heads/${pull.base}..${pull.head}`,
      );
      const commits = log.output
        .split("\u001E")
        .map((entry) => entry.trim())
        .filter((entry) => entry !== "")
        .map((entry) => {
          const [sha = "", message = ""] = entry.split("\u001F");
          return { commit: { message: message.trim() }, sha };
        });
      return ok(yield* Effect.orDie(encodeJson([commits])));
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
        autoMergeRequest:
          pull.autoMergeBy === undefined ? null : { enabledBy: { login: pull.autoMergeBy } },
        baseRefName: pull.base,
        body: pull.body,
        headRefName: pull.branch,
        headRefOid: pull.head,
        mergeCommit: pull.mergedBy === undefined ? null : { oid: pull.mergedBy.commit },
        mergeStateStatus: conflicting ? "DIRTY" : behind ? "BEHIND" : "CLEAN",
        mergeable: conflicting ? "CONFLICTING" : "MERGEABLE",
        number: pull.number,
        state: pull.state,
        statusCheckRollup:
          ci === undefined
            ? []
            : [
                ...(this.rerun.has(pull.head)
                  ? [{ ...VERIFY, conclusion: "CANCELLED", status: "COMPLETED" }]
                  : []),
                {
                  ...VERIFY,
                  conclusion: ci === "pending" ? null : ci.toUpperCase(),
                  status: ci === "pending" ? "IN_PROGRESS" : "COMPLETED",
                },
              ],
        title: pull.title,
        url: `https://github.invalid/pull/${pull.number}`,
      };
    });
  }

  enableAutoMerge(number: number, login: string): void {
    const pull = this.pulls.find((candidate) => candidate.number === number);
    if (pull === undefined) throw new Error(`no pull request #${number}`);
    pull.autoMergeBy = login;
  }

  mergeOutside(number: number, login: string): Effect.Effect<string> {
    return Effect.gen({ self: this }, function* () {
      const pull = this.pulls.find((candidate) => candidate.number === number);
      if (pull === undefined) throw new Error(`no pull request #${number}`);
      yield* this.refresh(pull);
      return yield* this.land(pull, login);
    });
  }

  private land(pull: FakePull, login: string, message?: string): Effect.Effect<string> {
    return Effect.gen({ self: this }, function* () {
      const commit = yield* git(
        this.origin,
        `-c user.name=t -c user.email=t@example.invalid commit-tree -m "pull #${pull.number}" -p refs/heads/${pull.base} ${pull.head}^{tree}`,
      );
      yield* git(this.origin, `update-ref refs/heads/${pull.base} ${commit.output}`);
      pull.state = "MERGED";
      const at = DateTime.formatIso(yield* DateTime.now);
      pull.mergedBy = { at, commit: commit.output, login };
      this.messages.set(commit.output, message ?? `pull #${pull.number}`);
      return commit.output;
    });
  }

  private mergeRequest(args: readonly string[]): Effect.Effect<orchestratorTypes.GhResult> {
    const { body, method, number, sha, subject } = mergeRequestOf(args);
    return Effect.gen({ self: this }, function* () {
      this.requests.push({ number, sha });
      const pull = this.pulls.find((candidate) => String(candidate.number) === number);
      if (pull === undefined) return refused("gh: Not Found (HTTP 404)");
      if (method !== "squash") return refused("gh: squash only (HTTP 405)");
      if (this.beforeMerge !== undefined) yield* this.beforeMerge;
      if (this.mergeRefusal !== undefined) return this.mergeRefusal;
      yield* this.refresh(pull);
      if (pull.state !== "OPEN") return refused("gh: Pull Request is not mergeable (HTTP 405)");
      if (pull.head !== sha) {
        return refused("gh: Head branch was modified. Review and try the merge again. (HTTP 409)");
      }
      if (yield* this.behind(pull)) {
        return refused("gh: Head branch is out of date (HTTP 405)");
      }
      const ci = this.ci.get(pull.head);
      if (ci !== undefined && ci !== "success") {
        return refused('gh: Required status check "verify" is expected. (HTTP 405)');
      }
      const commit = yield* this.land(pull, "harness", `${subject}\n\n${body}`);
      this.merged.push({ body, number: pull.number, sha, subject });
      if (this.afterMerge !== undefined) yield* this.afterMerge;
      return (
        this.mergeAnswer ??
        ok(
          yield* Effect.orDie(
            encodeJson({ merged: true, message: "Pull Request successfully merged", sha: commit }),
          ),
        )
      );
    });
  }
}
