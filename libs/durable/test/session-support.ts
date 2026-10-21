import contextModule from "@msa/chord/context";
import type chordTypes from "@msa/chord/index.types";
import type durableTypes from "@msa/durable/index.types";
import { Effect } from "effect";

import clockModule from "../src/clock.ts";
import SessionImpl from "../src/session/session.ts";
import type sessionTypes from "../src/session/session.types.ts";
import ControlledStorage from "./controlled-storage.ts";
import effectSupport from "./effect-support.ts";

const { BACKGROUND_CONTEXT } = contextModule;
const { currentTimeMillis } = clockModule;
const { awaited } = effectSupport;

const context: chordTypes.Context = BACKGROUND_CONTEXT;
function openTestSession(): {
  readonly storage: ControlledStorage;
  readonly session: sessionTypes.SessionImpl;
  readonly publications: durableTypes.CommitPublication[];
} {
  const storage = new ControlledStorage();
  const session = new SessionImpl(storage, currentTimeMillis, () => 600_000);
  const publications: durableTypes.CommitPublication[] = [];
  session.subscribeCommits((publication) => {
    publications.push(publication);
  });
  return { publications, session, storage };
}
function documentChanges(
  publication: durableTypes.CommitPublication,
): readonly Extract<durableTypes.DocumentCommitChange, { readonly type: "document" }>[] {
  return publication.changes.filter(
    (change): change is Extract<durableTypes.DocumentCommitChange, { readonly type: "document" }> =>
      change.type === "document",
  );
}
function documentCopyChanges(
  publication: durableTypes.CommitPublication,
): readonly Extract<durableTypes.DocumentCommitChange, { readonly type: "document.copy" }>[] {
  return publication.changes.filter(
    (
      change,
    ): change is Extract<durableTypes.DocumentCommitChange, { readonly type: "document.copy" }> =>
      change.type === "document.copy",
  );
}
function createConversation(
  session: sessionTypes.SessionImpl,
): Promise<durableTypes.ConversationId> {
  return Promise.resolve(
    session.commit(
      (tx) =>
        Effect.runPromise(
          Effect.gen(function* () {
            return (yield* awaited(tx.createConversation({ ownership: { kind: "ownerless" } }))).id;
          }),
        ),
      context,
    ),
  );
}
const flush: Effect.Effect<void> = Effect.sleep(1);

const sessionSupport = {
  context,
  createConversation,
  documentChanges,
  documentCopyChanges,
  flush,
  openTestSession,
};

export default sessionSupport;
