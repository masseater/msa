import codingAgent from "@msa/coding-agent";
import { Console, Effect } from "effect";

const { ModelRuntime, createAgentSession } = codingAgent;

void Effect.runPromise(
  Effect.gen(function* () {
    const modelRuntime = yield* Effect.promise(() => ModelRuntime.create());

    const opus = modelRuntime.getModel("anthropic-api", "claude-opus-4-5");
    if (opus !== undefined) {
      yield* Console.log(`Found model: ${opus.provider}/${opus.id}`);
    }

    const customModel = modelRuntime.getModel("my-provider", "my-model");
    if (customModel !== undefined) {
      yield* Console.log(`Found custom model: ${customModel.provider}/${customModel.id}`);
    }

    const available = yield* Effect.promise(() => modelRuntime.getAvailable());
    yield* Console.log(
      "Available models:",
      available.map((m) => `${m.provider}/${m.id}`),
    );

    if (available.length > 0) {
      const { session } = yield* Effect.promise(() =>
        createAgentSession({
          model: available[0],
          modelRuntime,
          thinkingLevel: "medium",
        }),
      );

      try {
        session.subscribe((event) => {
          if (
            event.type === "message_update" &&
            event.assistantMessageEvent.type === "text_delta"
          ) {
            process.stdout.write(event.assistantMessageEvent.delta);
          }
        });

        yield* Effect.promise(() => session.run.prompting.prompt("Say hello in one sentence."));
        yield* Console.log();
      } finally {
        session.dispose();
      }
    }
  }),
);
