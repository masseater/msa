import type { Context } from "@msa/chord";
import { Effect } from "effect";

import { CommittedWatch } from "../session/observation.ts";
import { toPromise } from "./bridge.ts";
import { snapshotOf } from "./events-snapshot.ts";
import { translate } from "./events-translate.ts";
import type { AgentEvent, SnapshotEvent } from "./events-types.ts";
import type { ConversationId, Storage, TaskId } from "./types.ts";
import { scanAll } from "./util.ts";
import type { ConversationView, ConversationViews } from "./view.ts";

const COMPLETING_PAGE_SIZE = 100;

export type Attached = {
  readonly watch: CommittedWatch<readonly AgentEvent[]>;
  readonly snapshot: SnapshotEvent;
};

const heldTasks = Effect.fnUntraced(function* (
  storage: Storage,
  conversationId: ConversationId,
  context: Context,
) {
  const query = { conversationId, kind: "msa.generation", status: "completing" } as const;
  const completing = yield* scanAll((cursor) =>
    storage.scanTasks(query, COMPLETING_PAGE_SIZE, cursor, context),
  );
  return new Set<TaskId>(completing.map((record) => record.id));
});

export const attachEvents = Effect.fnUntraced(function* (
  views: ConversationViews,
  conversationId: ConversationId,
  context: Context,
) {
  const readHeld = yield* toPromise(heldTasks);
  let attached: Attached | undefined;
  const observe = (initial: ConversationView, release: () => void, held: Set<TaskId>) => {
    let current = initial;
    const watch = new CommittedWatch<readonly AgentEvent[]>(
      [],
      release,
      (error) => {
        views.report(error);
      },
      () => [snapshotOf(current)],
    );
    attached = { watch, snapshot: snapshotOf(initial) };
    return {
      publication: (
        before: ConversationView,
        after: ConversationView,
        ops: Parameters<typeof translate>[2],
        publication: Parameters<typeof translate>[3],
        commitContext: Context,
      ) => {
        current = after;
        const events = translate(conversationId, { after, before }, ops, publication, held);
        if (events.length > 0) watch.advance(events, [], commitContext);
      },
      closeSession: (failure: { readonly error: unknown } | undefined) =>
        watch.closeSession(failure),
    };
  };
  yield* Effect.promise(() =>
    views.attach(
      conversationId,
      (initial, release, storage) =>
        readHeld(storage, conversationId, context).then((held) => observe(initial, release, held)),
      context,
    ),
  );
  return attached!;
});
