import { Effect } from "effect";

import exec from "../src/core/exec.ts";

const { execCommand } = exec;

const GIT_TIMEOUT_MS = 30_000;

export default class OriginRefs {
  private readonly ancestry = new Map<string, boolean>();
  private readonly origin: string;

  constructor(origin: string) {
    this.origin = origin;
  }

  sync(
    branch: string,
    base: string,
    head: string,
  ): Effect.Effect<{ head: string; behind: boolean }> {
    return Effect.gen({ self: this }, function* () {
      const listed = yield* Effect.promise(() =>
        execCommand(
          "git",
          [
            "for-each-ref",
            "--format=%(refname) %(objectname)",
            `refs/heads/${branch}`,
            `refs/heads/${base}`,
          ],
          this.origin,
          { timeout: GIT_TIMEOUT_MS },
        ),
      );
      const tips = new Map(
        listed.stdout
          .trim()
          .split("\n")
          .map((line) => line.split(" ") as [string, string]),
      );
      const current = tips.get(`refs/heads/${branch}`) ?? head;
      const baseTip = tips.get(`refs/heads/${base}`);
      if (baseTip === undefined) return { behind: true, head: current };
      return { behind: !(yield* this.contains(baseTip, current)), head: current };
    });
  }

  private contains(ancestor: string, descendant: string): Effect.Effect<boolean> {
    return Effect.gen({ self: this }, function* () {
      const key = `${ancestor} ${descendant}`;
      const known = this.ancestry.get(key);
      if (known !== undefined) return known;
      const checked = yield* Effect.promise(() =>
        execCommand("git", ["merge-base", "--is-ancestor", ancestor, descendant], this.origin, {
          timeout: GIT_TIMEOUT_MS,
        }),
      );
      this.ancestry.set(key, checked.code === 0);
      return checked.code === 0;
    });
  }
}
