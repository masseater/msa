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

interface SquashOfHead {
  head: string | undefined;
  message: SquashMessage;
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

function squashMessageOf<E, R>(
  gh: (args: readonly string[]) => Effect.Effect<string, E, R>,
  unreadable: () => E,
  number: number,
  title: string,
): Effect.Effect<SquashOfHead, E, R> {
  return Effect.gen(function* () {
    const json = yield* gh([
      "api",
      "--paginate",
      "--slurp",
      `repos/{owner}/{repo}/pulls/${number}/commits`,
    ]);
    const commits = yield* Effect.fromOption(
      Option.map(Schema.decodeOption(PullCommitPagesJson)(json), (pages) => pages.flat()),
    ).pipe(Effect.mapError(unreadable));
    const messages = commits.map((entry) => entry.commit.message);
    return { head: commits.at(-1)?.sha, message: squashMessage(number, title, messages) };
  });
}

const squashMessageModule = { squashMessageOf, textOf };

export default squashMessageModule;
