import { describe, expect, expectTypeOf, it } from "vite-plus/test";

import type typesModule from "../src/types.types.ts";

const base = {
  content: [],
  isError: false,
  role: "toolResult" as const,
  timestamp: 1,
  toolCallId: "call-1",
  toolName: "read",
};

interface Details {
  path: string;
  items: readonly string[];
  summary?: {
    lines?: number;
  };
}

describe("message JSON types", () => {
  it("preserves JSON-compatible detail types without requiring index signatures", () => {
    const objectMessage: typesModule.ToolResultMessage<Details> = {
      ...base,
      details: { items: ["first"], path: "a.ts", summary: { lines: 3 } },
    };
    const arrayMessage: typesModule.ToolResultMessage<string[]> = { ...base, details: ["a", "b"] };
    const readonlyArrayMessage: typesModule.ToolResultMessage<
      readonly [string, { readonly count?: number }]
    > = {
      ...base,
      details: ["a", { count: 1 }],
    };
    const primitiveMessage: typesModule.ToolResultMessage<string> = {
      ...base,
      details: "diagnostic",
    };
    const nullMessage: typesModule.ToolResultMessage<null> = { ...base, details: null };
    const transcriptMessage: typesModule.Message = objectMessage;
    const readonlyTranscriptMessage: typesModule.Message = readonlyArrayMessage;
    const context: typesModule.Context = { messages: [objectMessage, readonlyArrayMessage] };

    expect(objectMessage.details?.summary?.lines).toBe(3);
    expect(arrayMessage.details).toEqual(["a", "b"]);
    expect(readonlyArrayMessage.details).toEqual(["a", { count: 1 }]);
    expect(primitiveMessage.details).toBe("diagnostic");
    expect(nullMessage.details).toBeNull();
    expect(transcriptMessage).toBe(objectMessage);
    expect(readonlyTranscriptMessage).toBe(readonlyArrayMessage);
    expect(context.messages).toEqual([objectMessage, readonlyArrayMessage]);
    expectTypeOf<typesModule.ToolResultMessage["details"]>().toEqualTypeOf<
      typesModule.JsonValue | undefined
    >();
  });

  it("rejects non-JSON detail types", () => {
    type OptionalAny = { value?: any };
    expectTypeOf<typesModule.ToolResultMessage<OptionalAny>>().toEqualTypeOf<never>();
    expectTypeOf<typesModule.ToolResultMessage<undefined[]>>().toEqualTypeOf<never>();
    expectTypeOf<typesModule.ToolResultMessage<{ callback: () => void }>>().toEqualTypeOf<never>();
    expectTypeOf<typesModule.ToolResultMessage<{ value: unknown }>>().toEqualTypeOf<never>();
    expectTypeOf<typesModule.ToolResultMessage<{ value: Date }>>().toEqualTypeOf<never>();
  });
});
