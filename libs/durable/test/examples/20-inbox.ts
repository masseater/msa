import * as NodeRuntime from "@effect/platform-node/NodeRuntime";
import type { FauxResponseStep } from "@msa/ai";
import { createModels } from "@msa/ai/models";
import { fauxAssistantMessage, fauxProvider } from "@msa/ai/providers/faux";
import { BACKGROUND_CONTEXT } from "@msa/chord/context";
import { Console, Effect } from "effect";

import { createRegistry, Harness } from "../../src/harness/index.ts";
import { InboxDoc, type Submission } from "../../src/index.ts";
import { MemoryStorage } from "../../src/storage/memory.ts";
import { awaited } from "../effect-support.ts";

const context = BACKGROUND_CONTEXT;

let release!: () => void;
const held = new Promise<void>((resolve) => {
  release = resolve;
});
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

const main = Effect.gen(function* () {
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
      agent: { model: { provider: "faux", modelId: "faux-1" } },
    }),
  );

  const first = yield* awaited(root.submit({ type: "input", content: "First question" }, context));

  const followUp = yield* awaited(root.submit({ type: "input", content: "A follow-up" }, context));
  const steer = yield* awaited(
    root.submit({ type: "input", content: "A steer", whenBusy: "steer" }, context),
  );
  const note = yield* awaited(
    root.submit({ type: "write", entry: { kind: "app.note", data: "noted while busy" } }, context),
  );
  const withdrawn = yield* awaited(root.submit({ type: "input", content: "Never mind" }, context));
  yield* awaited(
    root
      .submit({ type: "input", content: "Now or never", whenBusy: "reject" }, context)
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
  const status = Effect.fn("status")(function* (name: string, submission: Submission) {
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
