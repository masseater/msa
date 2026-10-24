import testing from "@msa/testing";
import { Effect } from "effect";

import FakeGitHub from "./fake-github.ts";
import worktreeSupport from "./worktree-support.ts";

const { joinPath, makeTempDir, removePath } = testing;
const { GIT, sh } = worktreeSupport;

interface Remote {
  repository: string;
  origin: string;
  github: FakeGitHub;
}

function withRemote<A, E>(body: (remote: Remote) => Effect.Effect<A, E>) {
  return Effect.acquireUseRelease(
    makeTempDir("msa-pull-request-"),
    (parent) =>
      Effect.gen(function* () {
        const repository = joinPath(parent, "repo");
        const origin = joinPath(parent, "origin.git");
        yield* sh(`git init -q --bare -b main origin.git`, parent);
        yield* sh(`mkdir repo && echo app > repo/README && git -C repo init -q -b main`, parent);
        yield* sh(`git add . && ${GIT} commit -q -m init`, repository);
        yield* sh(
          `git remote add origin ${origin} && git push -q -u origin main && git remote set-head origin main`,
          repository,
        );
        return yield* body({ github: new FakeGitHub(origin), origin, repository });
      }),
    (parent) => removePath(parent),
  );
}

function commitAndPush(cwd: string, file: string, branch: string) {
  return sh(
    `echo ${file} > ${file} && git add ${file} && ${GIT} commit -q -m ${file} && git push -q origin ${branch}`,
    cwd,
  );
}

function advanceMain(origin: string, parent: string, file: string) {
  return sh(
    `git clone -q ${origin} side-${file} && cd side-${file} && echo ${file} > ${file} && git add ${file} && ${GIT} commit -q -m ${file} && git push -q origin main && cd .. && rm -rf side-${file}`,
    parent,
  );
}

const pullRequestSupport = { advanceMain, commitAndPush, withRemote };

export default pullRequestSupport;
