import type chordTypes from "@msa/chord/index.types";

import type typesModule from "../types.types.ts";
import type unrefTimerTypes from "../unref-timer.types.ts";
import type transactionTypesModule from "./transaction-types.types.ts";
import type transactionTypes from "./transaction.types.ts";

declare namespace sessionStateTypes {
  type CommitListener = (
    publication: typesModule.CommitPublication,
    context: chordTypes.Context,
  ) => void;

  type SessionHooks = {
    report(error: unknown): void;
    fail(error: unknown): void;
    conversationCreated(
      tx: transactionTypes.Transaction,
      record: typesModule.ConversationRecord,
    ): Promise<void>;
    beforeClose(): Promise<void>;
  };

  type DocumentSweep = {
    readonly at: number;
    timer: unrefTimerTypes.UnrefTimer | undefined;
  };

  type SessionState = {
    readonly hooks: SessionHooks;
    readonly storage: typesModule.Storage;
    readonly now: () => number;
    readonly clock: () => number;
    readonly documentRetentionMs: () => number;
    readonly documents: Map<string, transactionTypesModule.LoadedDocument>;
    readonly idleDocuments: Map<string, number>;
    readonly attachedDocuments: Map<typesModule.DocumentId, number>;
    documentSweep: DocumentSweep | undefined;
    sweepJobs: number;
    documentTimersUnavailable: boolean;
    readonly commitListeners: Set<CommitListener>;
    readonly internalListeners: Set<CommitListener>;
    readonly closeListeners: Set<() => void>;
    tail: Promise<void>;
    closing: Promise<void> | undefined;
    failure: { readonly error: unknown } | undefined;
    readonly failed: PromiseWithResolvers<never>;
    readonly closed: PromiseWithResolvers<typesModule.SessionEnd>;
  };

  type DocumentCacheSizes = {
    readonly cached: number;
    readonly idle: number;
    readonly attached: number;
    readonly sweeps: number;
  };
}

export type { sessionStateTypes as default };
