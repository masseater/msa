import { Effect, Option, Result } from "effect";
import * as Schema from "effect/Schema";

import config from "../config.ts";
import orchestratorGh from "../core/agent-session/orchestrator-gh.ts";
import pullRequestSquashModule from "../core/orchestrator/pull-request-squash.ts";
import squashMessageModule from "../core/orchestrator/squash-message.ts";
import platform from "../core/platform/index.ts";

const { APP_NAME } = config;
const { pullRequestSquash } = pullRequestSquashModule;
const { textOf } = squashMessageModule;
const { writeError } = platform;

const USAGE = `${APP_NAME} squash-message <pull request number> <head sha>`;

const HELP = `Usage: ${USAGE}

Print the commit message the harness and merge_pull_request send when they squash-merge the
pull request at that head: its title with the number as the subject, the messages of its
commits as the body, and the Msa-Merge trailer. Fails when GitHub does not list the
commits of the pull request up to that head. Reads the pull request with gh.`;

const PullTitle = Schema.fromJsonString(Schema.Struct({ title: Schema.String }));

function fail(message: string): void {
  writeError(message);
  process.exitCode = 1;
}

function messageOf(number: number, head: string, cwd: string): Effect.Effect<string, string> {
  return Effect.gen(function* () {
    const gh = pullRequestSquash.ghWith(orchestratorGh.runGh, cwd);
    const viewed = yield* gh(["pr", "view", String(number), "--json", "title"]);
    if (viewed.code !== 0) {
      return yield* Effect.fail(`gh pr view: ${(viewed.stderr || viewed.stdout).trim()}`);
    }
    const title = Option.getOrUndefined(Schema.decodeOption(PullTitle)(viewed.stdout))?.title;
    if (title === undefined)
      return yield* Effect.fail("gh pr view printed JSON that cannot be read");
    const prepared = yield* pullRequestSquash.prepare(gh, number, { sha: head, title });
    return textOf(prepared.squashed);
  });
}

function runSquashMessage(args: readonly string[]): Promise<void> {
  const [numberArg = "", head = "", ...rest] = args;
  if (numberArg === "--help" || numberArg === "-h") {
    process.stdout.write(`${HELP}\n`);
    return Promise.resolve();
  }
  if (!/^[1-9]\d*$/u.test(numberArg) || !/^[0-9a-f]{40}$/u.test(head) || rest.length > 0) {
    fail(`Usage: ${USAGE}`);
    return Promise.resolve();
  }
  return Effect.runPromise(
    Effect.map(Effect.result(messageOf(Number(numberArg), head, process.cwd())), (result) => {
      if (Result.isFailure(result)) fail(result.failure);
      else process.stdout.write(result.success);
    }),
  );
}

const runSquashMessageModule = { runSquashMessage };

export default runSquashMessageModule;
