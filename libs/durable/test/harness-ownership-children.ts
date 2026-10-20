import type { Context } from "@msa/chord";
import durable from "@msa/durable";
import type durableTypes from "@msa/durable/index.types";
import { Effect } from "effect";

import effectSupport from "./effect-support.ts";

const { configure } = durable;

const { awaited } = effectSupport;

const spawnFauxChild = Effect.fn("spawnFauxChild")(function* (
  api: durableTypes.ToolExecutionApi,
  callContext: Context,
) {
  return yield* awaited(
    api.commit(
      (tx) =>
        tx
          .createConversation({ ownership: { kind: "task", taskId: api.taskId } })
          .then((created) =>
            configure(tx, created.id, { model: { modelId: "faux-1", provider: "faux" } }).then(
              () => created.id,
            ),
          ),
      callContext,
    ),
  );
});

const reuseFauxChild = Effect.fn("reuseFauxChild")(function* (
  api: durableTypes.ToolExecutionApi,
  callContext: Context,
) {
  const runPromise = Effect.runPromiseWith(yield* Effect.context<never>());
  return yield* awaited(
    api.commit(
      (tx) =>
        runPromise(
          Effect.gen(function* () {
            const existing = (yield* awaited(tx.scanConversations({ ownerTaskId: api.taskId }, 1)))
              .items[0];
            if (existing !== undefined) return existing.id;
            const created = yield* awaited(
              tx.createConversation({ ownership: { kind: "task", taskId: api.taskId } }),
            );
            yield* awaited(
              configure(tx, created.id, { model: { modelId: "faux-1", provider: "faux" } }),
            );
            return created.id;
          }),
        ),
      callContext,
    ),
  );
});

const harnessOwnershipChildren = {
  reuseFauxChild,
  spawnFauxChild,
};

export default harnessOwnershipChildren;
