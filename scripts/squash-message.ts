import { Console, Data, Effect, Schema } from "effect";

import squashMessageModule from "../apps/coding-agent/src/core/orchestrator/squash-message.ts";
import captureProcessModule from "../tools/capture-process.ts";
import runMain from "../tools/run-main.ts";

const { mergeArgs, squashMessageAt, textOf } = squashMessageModule;
const { captureProcess, processRunnerLayer } = captureProcessModule;
const { runMainWith } = runMain;

const USAGE = [
  "usage: squash-message.ts print <number> <head sha> <title>",
  "       squash-message.ts merge <number> <head sha>",
].join("\n");

class SquashMessageError extends Data.TaggedError("SquashMessageError")<{
  readonly message: string;
}> {}

const PullJson = Schema.fromJsonString(Schema.Struct({ title: Schema.String }));

const gh = (args: readonly string[]) =>
  Effect.flatMap(captureProcess({ args, command: "gh", cwd: "." }), (result) =>
    result.exitCode === 0
      ? Effect.succeed(result.stdout)
      : Effect.fail(new SquashMessageError({ message: `gh ${args.join(" ")}: ${result.stderr}` })),
  );

const titleOf = (number: number) =>
  Effect.flatMap(gh(["pr", "view", String(number), "--json", "title"]), (json) =>
    Schema.decodeEffect(PullJson)(json).pipe(
      Effect.map((pull) => pull.title),
      Effect.mapError(
        () => new SquashMessageError({ message: "gh pr view printed JSON that cannot be read" }),
      ),
    ),
  );

interface Args {
  number: number;
  head: string;
  title: string | undefined;
}

const ARITY = new Map([
  ["merge", 3],
  ["print", 4],
]);

function argsOf(argv: readonly string[]): Args | null {
  const [command = "", numberArg = "", head = "", title] = argv;
  const valid = ARITY.get(command) === argv.length && /^[1-9]\d*$/u.test(numberArg) && head !== "";
  return valid ? { head, number: Number(numberArg), title } : null;
}

const program = Effect.gen(function* () {
  const args = argsOf(process.argv.slice(2));
  if (args === null) return yield* new SquashMessageError({ message: USAGE });
  const { head, number } = args;
  const merging = args.title === undefined;
  const title = args.title ?? (yield* titleOf(number));
  const message = yield* squashMessageAt(
    gh,
    (reason) => new SquashMessageError({ message: reason }),
    number,
    title,
    head,
  );
  if (merging) yield* gh(mergeArgs(number, head, message));
  yield* Console.log(textOf(message).trimEnd());
});

runMainWith(program, processRunnerLayer);
