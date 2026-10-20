import * as NodeRuntime from "@effect/platform-node/NodeRuntime";
import type { FauxResponseStep } from "@msa/ai";
import { createModels } from "@msa/ai/models";
import { fauxAssistantMessage, fauxProvider } from "@msa/ai/providers/faux";
import contextModule from "@msa/chord/context";
import { Console, Effect } from "effect";

import type durableTypes from "../../src/index.types.ts";
import durableKit from "../durable-kit.ts";
import effectSupport from "../effect-support.ts";

const { BACKGROUND_CONTEXT } = contextModule;

const { durable, harness: harnessModule, memory } = durableKit;

const { Harness, createRegistry } = harnessModule;
const { MemoryStorage } = memory;
const { InboxDoc } = durable;

const { awaited } = effectSupport;

const context = BACKGROUND_CONTEXT;

const { promise: held, resolve: release } = Promise.withResolvers<void>();
const slow: FauxResponseStep = () =>
  Effect.runPromise(
    Effect.gen(function* () {
      yield* awaited(held);
      return fauxAssistantMessage("Answer to the first question.");
    }),
  );
const faux = fauxProvider();
faux.setResponses([slow, fauxAssistantMessage("Answer to the follow-up and the steer.")]);
const models = createModels();
models.setProvider(faux.provider);

const mainStep1 = Effect.gen(function* () {
  const runSync = Effect.runSyncWith(yield* Effect.context<never>());

  const harness = yield* awaited(
    Harness.open(
      new MemoryStorage(),
      { models, registry: createRegistry(), settings: { followUpMode: "all" } },
      context,
    ),
  );
  const root = yield* awaited(
    harness.root(context, {
      agent: { model: { modelId: "faux-1", provider: "faux" } },
    }),
  );

  const first = yield* awaited(root.submit({ content: "First question", type: "input" }, context));

  const followUp = yield* awaited(root.submit({ content: "A follow-up", type: "input" }, context));
  const steer = yield* awaited(
    root.submit({ content: "A steer", type: "input", whenBusy: "steer" }, context),
  );
  const note = yield* awaited(
    root.submit({ entry: { data: "noted while busy", kind: "app.note" }, type: "write" }, context),
  );
  const withdrawn = yield* awaited(root.submit({ content: "Never mind", type: "input" }, context));
  yield* awaited(
    root
      .submit({ content: "Now or never", type: "input", whenBusy: "reject" }, context)
      .catch((error: Error) => {
        runSync(Console.log("rejected:", error.message));
      }),
  );
  yield* Console.log("withdraw:", yield* awaited(withdrawn.abort(context)));

  const inbox = yield* awaited(harness.snapshot(InboxDoc, root.id, context));
  yield* Console.log(
    "inbox:",
    inbox?.items.map((item) => `${item.id} ${item.mode}`),
  );

  release();
  return { first, followUp, harness, note, root, steer, withdrawn };
});

const main = Effect.gen(function* () {
  const { harness, root, first, followUp, steer, note, withdrawn } = yield* mainStep1;
  const status = Effect.fn("status")(function* (name: string, submission: durableTypes.Submission) {
    const record = yield* awaited(submission.wait(context));
    yield* Console.log(
      `${name}:`,
      record.status,
      record.status === "unanswered" ? record.reason : "",
    );
  });
  yield* status("first", first);
  yield* status("follow-up", followUp);
  yield* status("steer", steer);
  yield* status("note", note);
  yield* status("withdrawn", withdrawn);

  const page = yield* awaited(root.entries({}, 20, undefined, context));
  yield* Console.log(
    "transcript:",
    [...page.items].reverse().map((entry) => entry.kind),
  );
  yield* awaited(harness.close(context));
});

NodeRuntime.runMain(main);
