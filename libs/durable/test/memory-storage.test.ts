import { BACKGROUND_CONTEXT } from "@msa/chord/context";
import { registerStorageConformance } from "@msa/durable/testing";
import { Effect } from "effect";
import { describe, expect, it } from "vite-plus/test";

import { idFromNumber, seqFromNumber } from "../src/ids.ts";
import { MemoryStorage } from "../src/storage/memory.ts";
import { type EntryId, ROOT_CONVERSATION_ID } from "../src/types.ts";
import effectSupport from "./effect-support.ts";

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
      const entryId = idFromNumber<EntryId>(2);
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
