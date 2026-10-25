import testing from "@msa/testing";
import { Effect } from "effect";

import type orchestratorTypes from "../src/core/orchestrator/orchestrator.types.ts";

const { encodeJson } = testing;

interface MergeRequest {
  number: string | undefined;
  method: string | undefined;
  sha: string;
  subject: string;
  body: string;
}

function mergeRequestOf(args: readonly string[]): MergeRequest {
  const fields = new Map(
    args.flatMap((arg, index) => {
      if (args[index - 1] !== "-f") return [];
      const at = arg.indexOf("=");
      return [[arg.slice(0, at), arg.slice(at + 1)] as const];
    }),
  );
  return {
    body: fields.get("commit_message") ?? "",
    method: fields.get("merge_method"),
    number: /^repos\/\{owner\}\/\{repo\}\/pulls\/(\d+)\/merge$/u.exec(
      args.find((arg) => arg.startsWith("repos/")) ?? "",
    )?.[1],
    sha: fields.get("sha") ?? "",
    subject: fields.get("commit_title") ?? "",
  };
}

function ok(stdout: string): orchestratorTypes.GhResult {
  return { code: 0, stderr: "", stdout };
}

function refused(stderr: string): orchestratorTypes.GhResult {
  return { code: 1, stderr, stdout: "" };
}

function commitOf(
  messages: ReadonlyMap<string, string>,
  refusal: orchestratorTypes.GhResult | undefined,
  path: string,
): Effect.Effect<orchestratorTypes.GhResult> {
  return Effect.gen(function* () {
    if (refusal !== undefined) return refusal;
    const message = messages.get(path.slice(path.lastIndexOf("/") + 1));
    if (message === undefined) {
      return { code: 1, stderr: "gh: No commit found for SHA (HTTP 422)", stdout: "" };
    }
    return {
      code: 0,
      stderr: "",
      stdout: yield* Effect.orDie(encodeJson({ commit: { message } })),
    };
  });
}

const fakeGitHubMerge = { commitOf, mergeRequestOf, ok, refused };

export default fakeGitHubMerge;
