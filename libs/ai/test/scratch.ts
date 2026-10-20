import { Console, Effect, Stream } from "effect";

import { createModels } from "../src/models.ts";
import { anthropicProvider } from "../src/providers/anthropic.ts";
import type { Context } from "../src/types.ts";
import { currentTimeMillis } from "../src/utils/clock.ts";

const models = createModels();

models.setProvider(anthropicProvider());

const model = models.getModel("anthropic-api", "claude-haiku-4-5");

if (model === undefined) throw new Error("model not found");

const main = Effect.gen(function* () {
  const auth = yield* Effect.promise(() => models.getAuth(model.provider));
  yield* Console.log(`model: ${model.provider}/${model.id}`);
  yield* Console.log(
    `auth:  ${auth === undefined ? "not configured" : `configured via ${auth.source}`}\n`,
  );
  if (auth === undefined) process.exit(1);
  const context: Context = {
    messages: [{ content: "Say exactly: ok", role: "user", timestamp: currentTimeMillis() }],
    systemPrompt: "You are terse.",
  };
  const message = yield* Effect.promise(() => models.completeSimple(model, context));
  yield* Console.log(`completeSimple -> [${message.stopReason}]`, message.content);
  context.messages.push(message, {
    content: "Now count from 1 to 5, one number per line.",
    role: "user",
    timestamp: currentTimeMillis(),
  });
  process.stdout.write("streamSimple   -> ");
  const stream = models.streamSimple(model, context);
  yield* Stream.fromAsyncIterable(stream, (error) => error).pipe(
    Stream.orDie,
    Stream.runForEach((event) =>
      Effect.sync(() => {
        if (event.type === "text_delta") process.stdout.write(event.delta.replaceAll("\n", " "));
      }),
    ),
  );
  const final = yield* Effect.promise(() => stream.result());
  yield* Console.log(`[${final.stopReason}] cost: $${final.usage.cost.total.toFixed(6)}`);
});

void Effect.runPromise(main);
