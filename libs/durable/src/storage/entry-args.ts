import type { Context } from "@msa/chord";
import { Function } from "effect";

import errors from "../errors.ts";
import ids from "../ids.ts";
import type typesModule from "../types.types.ts";

const { idFromNumber } = ids;
const { StorageRequestError } = errors;

type EntryResult = ReturnType<typesModule.Storage["entry"]>;

const forwardEntry: {
  (
    idOrConversationId: typesModule.EntryId | typesModule.ConversationId,
    idOrContext: typesModule.EntryId | Context,
    context: Context | undefined,
  ): (store: typesModule.Storage) => EntryResult;
  (
    store: typesModule.Storage,
    idOrConversationId: typesModule.EntryId | typesModule.ConversationId,
    idOrContext: typesModule.EntryId | Context,
    context: Context | undefined,
  ): EntryResult;
} = Function.dual(
  4,
  (
    store: typesModule.Storage,
    idOrConversationId: typesModule.EntryId | typesModule.ConversationId,
    idOrContext: typesModule.EntryId | Context,
    context: Context | undefined,
  ): EntryResult => {
    if (context === undefined)
      return store.entry(
        idFromNumber<typesModule.EntryId>(idOrConversationId),
        idOrContext as Context,
      );
    if (typeof idOrContext !== "number")
      throw new StorageRequestError("Storage.entry() requires an entry ID");
    return store.entry(
      idFromNumber<typesModule.ConversationId>(idOrConversationId),
      idFromNumber<typesModule.EntryId>(idOrContext),
      context,
    );
  },
);

const entryArgs = {
  forwardEntry,
};

export default entryArgs;
