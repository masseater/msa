import { Console, Data, Effect } from "effect";

import squashMessageModule from "../apps/coding-agent/src/core/orchestrator/squash-message.ts";
import captureProcessModule from "../tools/capture-process.ts";
import runMain from "../tools/run-main.ts";

const { squashMessageOf, textOf } = squashMessageModule;
const { captureProcess, processRunnerLayer } = captureProcessModule;
const { runMainWith } = runMain;

class SquashMessageError extends Data.TaggedError("SquashMessageError")<{
  readonly message: string;
}> {}

const gh = (args: readonly string[]) =>
  Effect.flatMap(captureProcess({ args, command: "gh", cwd: "." }), (result) =>
    result.exitCode === 0
      ? Effect.succeed(result.stdout)
      : Effect.fail(new SquashMessageError({ message: `gh ${args.join(" ")}: ${result.stderr}` })),
  );

const program = Effect.gen(function* () {
  const [numberArg = "", title = ""] = process.argv.slice(2);
  const number = Number(numberArg);
  if (!Number.isInteger(number) || number <= 0) {
    return yield* new SquashMessageError({ message: "usage: squash-message.ts <number> <title>" });
  }
  const { message } = yield* squashMessageOf(
    gh,
    () =>
      new SquashMessageError({ message: "gh api printed commits JSON this script cannot read" }),
    number,
    title,
  );
  yield* Console.log(textOf(message).trimEnd());
});

runMainWith(program, processRunnerLayer);
