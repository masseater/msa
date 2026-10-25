import { Effect, Option } from "effect";
import * as Schema from "effect/Schema";

const PullCommitPagesJson = Schema.Struct({
  commit: Schema.Struct({ message: Schema.String }),
  sha: Schema.String,
}).pipe(Schema.Array, Schema.Array, Schema.fromJsonString);

interface SquashMessage {
  subject: string;
  body: string;
}

function normalized(message: string): string {
  return message.replaceAll("\r\n", "\n").trim();
}

function bodyOf(message: string): string {
  return normalized(message).split("\n").slice(1).join("\n").trim();
}

function squashMessage(number: number, title: string, messages: readonly string[]): SquashMessage {
  const subject = title === "" ? `#${number}` : `${title} (#${number})`;
  const body =
    messages.length === 1
      ? bodyOf(messages[0] ?? "")
      : messages
          .map(normalized)
          .filter((message) => message !== "")
          .join("\n\n");
  return { body, subject };
}

function textOf(message: SquashMessage): string {
  return message.body === "" ? `${message.subject}\n` : `${message.subject}\n\n${message.body}\n`;
}

function squashMessageAt<E, R>(
  gh: (args: readonly string[]) => Effect.Effect<string, E, R>,
  failure: (reason: string) => E,
  number: number,
  title: string,
  head: string,
): Effect.Effect<SquashMessage, E, R> {
  return Effect.gen(function* () {
    const json = yield* gh([
      "api",
      "--paginate",
      "--slurp",
      `repos/{owner}/{repo}/pulls/${number}/commits`,
    ]);
    const commits = yield* Effect.fromOption(
      Option.map(Schema.decodeOption(PullCommitPagesJson)(json), (pages) => pages.flat()),
    ).pipe(Effect.mapError(() => failure("gh api printed commits JSON that cannot be read")));
    const listed = commits.at(-1)?.sha;
    if (listed !== head) {
      return yield* Effect.fail(
        failure(`GitHub lists the commits of #${number} up to ${listed ?? "none"}, not ${head}`),
      );
    }
    return squashMessage(
      number,
      title,
      commits.map((entry) => entry.commit.message),
    );
  });
}

function mergeArgs(number: number, head: string, message: SquashMessage): readonly string[] {
  return [
    "pr",
    "merge",
    String(number),
    "--squash",
    "--match-head-commit",
    head,
    "--subject",
    message.subject,
    "--body",
    message.body,
  ];
}

const squashMessageModule = { mergeArgs, squashMessageAt, textOf };

export default squashMessageModule;
