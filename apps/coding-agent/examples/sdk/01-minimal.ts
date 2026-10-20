import codingAgent from "@msa/coding-agent";
import { Console, Effect } from "effect";

const { createAgentSession } = codingAgent;

void Effect.runPromise(
  Effect.gen(function* () {
    const { session } = yield* Effect.promise(() => createAgentSession());

    try {
      session.subscribe((event) => {
        if (event.type === "message_update" && event.assistantMessageEvent.type === "text_delta") {
          process.stdout.write(event.assistantMessageEvent.delta);
        }
      });

      yield* Effect.promise(() => session.prompt("What files are in the current directory?"));
      for (const msg of session.state.messages) yield* Console.log(msg);
      yield* Console.log();
    } finally {
      session.dispose();
    }
  }),
);
