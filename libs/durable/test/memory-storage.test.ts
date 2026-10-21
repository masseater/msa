import contextModule from "@msa/chord/context";
import testing from "@msa/durable/testing";
import { Effect } from "effect";
import { describe, expect, it } from "vite-plus/test";

import ids from "../src/ids.ts";
import memory from "../src/storage/memory.ts";
import types from "../src/types.ts";
import type typesModule from "../src/types.types.ts";
import effectSupport from "./effect-support.ts";

const { BACKGROUND_CONTEXT } = contextModule;

const { registerStorageConformance } = testing;
const { MemoryStorage } = memory;
const { ROOT_CONVERSATION_ID } = types;
const { idFromNumber, seqFromNumber } = ids;

const { awaited } = effectSupport;

registerStorageConformance({ describe, expect, it }, "MemoryStorage", (use) =>
  use(new MemoryStorage()),
);

it("does not expose retained state through a prepared commit", () =>
  Effect.runPromise(
    Effect.gen(function* () {
      const storage = new MemoryStorage();
      yield* awaited(
        storage.commit(
          [{ type: "conversation", value: { id: ROOT_CONVERSATION_ID } }],
          BACKGROUND_CONTEXT,
        ),
      );
      const entryId = idFromNumber<typesModule.EntryId>(2);
      const prepared = storage.prepareCommit([
        {
          type: "entry",
          value: {
            conversationId: ROOT_CONVERSATION_ID,
            data: { nested: [1] },
            id: entryId,
            kind: "test",
          },
        },
      ]);
      const exposed = prepared.writes[0];
      if (exposed?.type !== "entry") throw new Error("Expected an entry write");
      expect(() => (exposed.value.data as { nested: number[] }).nested.push(2)).toThrow();

      expect(prepared.apply()).toBe(seqFromNumber(2));
      expect(prepared.apply()).toBe(seqFromNumber(2));
      expect((yield* awaited(storage.entry(entryId, BACKGROUND_CONTEXT)))?.entry.data).toEqual({
        nested: [1],
      });
    }),
  ));
