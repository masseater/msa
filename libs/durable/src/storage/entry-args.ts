import type { Context } from "@msa/chord";
import { Function } from "effect";

import { StorageRequestError } from "../errors.ts";
import { idFromNumber } from "../ids.ts";
import type { ConversationId, EntryId, Storage } from "../types.ts";

type EntryResult = ReturnType<Storage["entry"]>;

export const forwardEntry: {
  (
    idOrConversationId: EntryId | ConversationId,
    idOrContext: EntryId | Context,
    context: Context | undefined,
  ): (store: Storage) => EntryResult;
  (
    store: Storage,
    idOrConversationId: EntryId | ConversationId,
    idOrContext: EntryId | Context,
    context: Context | undefined,
  ): EntryResult;
} = Function.dual(
  4,
  (
    store: Storage,
    idOrConversationId: EntryId | ConversationId,
    idOrContext: EntryId | Context,
    context: Context | undefined,
  ): EntryResult => {
    if (context === undefined)
      return store.entry(idFromNumber<EntryId>(idOrConversationId), idOrContext as Context);
    if (typeof idOrContext !== "number")
      throw new StorageRequestError("Storage.entry() requires an entry ID");
    return store.entry(
      idFromNumber<ConversationId>(idOrConversationId),
      idFromNumber<EntryId>(idOrContext),
      context,
    );
  },
);
