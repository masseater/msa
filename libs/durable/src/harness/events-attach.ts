import type chordTypes from "@msa/chord/index.types";
import { Effect } from "effect";

import observation from "../session/observation.ts";
import bridge from "./bridge.ts";
import type eventsAttachTypes from "./events-attach.types.ts";
import eventsSnapshot from "./events-snapshot.ts";
import eventsTranslate from "./events-translate.ts";
import type typesModule from "./types.types.ts";
import util from "./util.ts";
import type viewTypes from "./view.types.ts";

const { scanAll } = util;
const { toPromise } = bridge;
const { CommittedWatch } = observation;
const { snapshotOf } = eventsSnapshot;
const { translate } = eventsTranslate;

const COMPLETING_PAGE_SIZE = 100;

const heldTasks = Effect.fnUntraced(function* (
  storage: typesModule.Storage,
  conversationId: typesModule.ConversationId,
  context: chordTypes.Context,
) {
  const query = { conversationId, kind: "msa.generation", status: "completing" } as const;
  const completing = yield* scanAll((cursor) =>
    storage.scanTasks(query, COMPLETING_PAGE_SIZE, cursor, context),
  );
  return new Set<typesModule.TaskId>(completing.map((record) => record.id));
});

const attachEvents = Effect.fnUntraced(function* (
  views: viewTypes.ConversationViews,
  conversationId: typesModule.ConversationId,
  context: chordTypes.Context,
) {
  const readHeld = yield* toPromise(heldTasks);
  let attached: eventsAttachTypes.Attached | undefined;
  const observe = (
    initial: viewTypes.ConversationView,
    release: () => void,
    held: Set<typesModule.TaskId>,
  ) => {
    let current = initial;
    const watch = new CommittedWatch<readonly eventsAttachTypes.AgentEvent[]>(
      [],
      release,
      (error) => {
        views.report(error);
      },
      () => [snapshotOf(current)],
    );
    attached = { snapshot: snapshotOf(initial), watch };
    return {
      closeSession: (failure: { readonly error: unknown } | undefined) =>
        watch.closeSession(failure),
      publication: (
        before: viewTypes.ConversationView,
        after: viewTypes.ConversationView,
        ops: Parameters<typeof translate>[2],
        publication: Parameters<typeof translate>[3],
        commitContext: chordTypes.Context,
      ) => {
        current = after;
        const events = translate(conversationId, { after, before }, ops, publication, held);
        if (events.length > 0) watch.advance(events, [], commitContext);
      },
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

const eventsAttach = {
  attachEvents,
};

export default eventsAttach;
