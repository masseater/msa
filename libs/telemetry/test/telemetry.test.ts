import { Effect } from "effect";
import { describe, expect, expectTypeOf, it } from "vite-plus/test";

import {
  InMemoryTelemetryContext,
  NOOP_TELEMETRY_CONTEXT,
  type SchemaTelemetrySpan,
  type SpanAttributes,
  type SpanOptions,
  type SpanStatus,
  type TelemetrySchemaSpanStartAttributes,
  type TelemetrySpan,
  type TypedSpanStarter,
  createTypedSpanStarter,
  defineTelemetrySchema,
} from "../src/index.ts";
import { rejectWith, rejectsWithSameValue } from "../src/testing/support.ts";

type Accepts<Callable, Args extends readonly unknown[]> = Callable extends (
  ...args: Args
) => unknown
  ? true
  : false;

type Callback = () => void;

function unreadable<T extends object>(value: T): T {
  return new Proxy(value, {
    get: () => {
      throw new Error("read");
    },
    getOwnPropertyDescriptor: () => {
      throw new Error("inspect");
    },
    ownKeys: () => {
      throw new Error("enumerate");
    },
  });
}

const operationDefinition = {
  spans: {
    operation: {
      description: "Test operation",
      endAttributes: {},
      events: {
        result: {
          attributes: {
            outcome: {
              description: "Outcome",
              required: true,
              type: "string",
              values: ["ok", "error"],
            },
          },
          description: "Result",
        },
      },
      parents: { kind: "any" },
      startAttributes: {
        kind: {
          description: "Kind",
          required: true,
          type: "string",
          values: ["read", "write"],
        },
      },
      status: { default: "ok", errorWhen: "The operation fails" },
    },
  },
  version: 1,
} as const;

const rootOperationSchema = defineTelemetrySchema({
  spans: {
    operation: {
      description: "Operation",
      endAttributes: {},
      parents: { kind: "root_or_external" },
      startAttributes: {
        kind: {
          description: "Kind",
          required: true,
          type: "string",
          values: ["read", "write"],
        },
      },
      status: { default: "ok", errorWhen: "The operation fails" },
    },
  },
  version: 1,
} as const);

const requestSchema = defineTelemetrySchema({
  spans: {
    request: {
      description: "Request",
      endAttributes: {
        response: { description: "Response kind", type: "string" },
      },
      parents: { kind: "spans", spans: ["operation"] },
      startAttributes: {
        provider: { description: "Provider", required: true, type: "string" },
      },
      status: { default: "ok", errorWhen: "The request fails" },
    },
  },
  version: 3,
} as const);

type OperationSpan = SchemaTelemetrySpan<typeof operationDefinition, "operation">;

function checkSchemaSpanTypes(span: OperationSpan): void {
  span.addEvent("result", { outcome: "ok" });
  expectTypeOf<
    Accepts<typeof span.addEvent<"result">, ["result", { outcome: "ok" }]>
  >().toEqualTypeOf<true>();
  expectTypeOf<Accepts<typeof span.addEvent<"result">, ["result"]>>().toEqualTypeOf<false>();
  expectTypeOf<
    Accepts<typeof span.addEvent<"result">, ["result", { outcome: "other" }]>
  >().toEqualTypeOf<false>();
  expectTypeOf<Accepts<OperationSpan["addEvent"], ["unknown", {}]>>().toEqualTypeOf<false>();
  expectTypeOf<
    Accepts<OperationSpan["setAttributes"], [{ unknown: true }]>
  >().toEqualTypeOf<false>();
}

function checkCombinedStarterTypes(telemetryContext: InMemoryTelemetryContext): void {
  const startSpan = createTypedSpanStarter(telemetryContext, [rootOperationSchema, requestSchema]);
  type Start = typeof startSpan;
  expectTypeOf<
    Accepts<Start, ["operation" | "request", { kind: "read" }, Callback]>
  >().toEqualTypeOf<false>();
  expectTypeOf<Accepts<Start, ["unknown", {}, Callback]>>().toEqualTypeOf<false>();

  const requestStarter: TypedSpanStarter<readonly [typeof requestSchema]> = startSpan;
  const extraRequestAttributes = { provider: "example", unknown: true } as const;
  type ExtraRequestAttributes = typeof extraRequestAttributes;
  expectTypeOf<
    Accepts<
      typeof requestStarter<ExtraRequestAttributes, void>,
      ["request", ExtraRequestAttributes, Callback]
    >
  >().toEqualTypeOf<false>();
  expectTypeOf<
    Accepts<
      typeof requestStarter<{ provider: string }, void>,
      ["request", { kind: "read" }, Callback]
    >
  >().toEqualTypeOf<false>();

  type DuplicateSchemas = readonly [typeof rootOperationSchema, typeof rootOperationSchema];
  expectTypeOf<
    Accepts<
      typeof createTypedSpanStarter<DuplicateSchemas>,
      [InMemoryTelemetryContext, DuplicateSchemas]
    >
  >().toEqualTypeOf<false>();
}

const runCombinedStarter = Effect.gen(function* () {
  const telemetryContext = new InMemoryTelemetryContext();
  const startSpan = createTypedSpanStarter(telemetryContext, [rootOperationSchema, requestSchema]);

  const result = yield* Effect.promise(() =>
    startSpan("operation", { kind: "read" }, (_operationSpan, startChildSpan) =>
      startChildSpan("request", { provider: "example" }, (requestSpan) => {
        requestSpan.setAttributes({ response: "cached" });
        return 42;
      }),
    ),
  );

  expect(result).toBe(42);
  expectTypeOf(result).toEqualTypeOf<number>();
  const spans = telemetryContext.getSpans();
  const operationSpan = spans.find((span) => span.name === "operation");
  const requestSpan = spans.find((span) => span.name === "request");
  expect(operationSpan?.parentId).toBeNull();
  expect(requestSpan?.parentId).toBe(operationSpan?.id);
  expect(() =>
    createTypedSpanStarter(
      telemetryContext,
      unreadable([rootOperationSchema, requestSchema] as const),
    ),
  ).not.toThrow();
  return { startSpan };
});

describe("telemetry schemas", () => {
  it("preserves serializable definitions and infers exact attributes", () => {
    const schema = defineTelemetrySchema(operationDefinition);
    expect(schema).toBe(operationDefinition);
    expect(() => JSON.stringify(schema)).not.toThrow();
    expectTypeOf<TelemetrySchemaSpanStartAttributes<typeof schema, "operation">>().toMatchTypeOf<{
      kind: "read" | "write";
    }>();
    expectTypeOf(checkSchemaSpanTypes).toBeFunction();
  });

  it("combines schema vocabularies and binds child starters to their parent spans", () =>
    Effect.runPromise(
      Effect.gen(function* () {
        const { startSpan } = yield* runCombinedStarter;

        const syncError = { kind: "sync" };
        const syncResult = startSpan("operation", { kind: "write" }, () => {
          throw syncError;
        });
        yield* rejectsWithSameValue(() => syncResult, syncError);

        const asyncError = { kind: "async" };
        const asyncResult = startSpan("request", { provider: "example" }, () =>
          rejectWith(asyncError),
        );
        yield* rejectsWithSameValue(() => asyncResult, asyncError);

        expectTypeOf(checkCombinedStarterTypes).toBeFunction();
      }),
    ));
});

const admitsNoopCallbacks = Effect.gen(function* () {
  const runPromise = Effect.runPromiseWith(yield* Effect.context());
  let admitted = false;
  let firstSpan: TelemetrySpan | undefined;
  const result = NOOP_TELEMETRY_CONTEXT.startSpan({ name: "first" }, (span) => {
    admitted = true;
    firstSpan = span;
    return runPromise(
      Effect.gen(function* () {
        const child = yield* Effect.promise(() =>
          span.startSpan({ name: "child" }, (childSpan) => childSpan),
        );
        expect(child).toBe(span);
        return 42;
      }),
    );
  });

  expect(admitted).toBe(true);
  expect(yield* Effect.promise(() => result)).toBe(42);
  expect(Object.isFrozen(firstSpan)).toBe(true);
});

const preservesNoopRejections = Effect.gen(function* () {
  const syncError = { kind: "sync" };
  const sync = NOOP_TELEMETRY_CONTEXT.startSpan({ name: "sync" }, () => {
    throw syncError;
  });
  yield* rejectsWithSameValue(() => sync, syncError);

  const asyncError = { kind: "async" };
  const asyncResult = NOOP_TELEMETRY_CONTEXT.startSpan({ name: "async" }, () =>
    rejectWith(asyncError),
  );
  yield* rejectsWithSameValue(() => asyncResult, asyncError);
});

function ignoreNoopPayloads(): Promise<void> {
  const options = unreadable<SpanOptions>({
    attributes: { secret: "prompt content" },
    name: "operation",
  });
  return NOOP_TELEMETRY_CONTEXT.startSpan(options, (span) => {
    const attributes = unreadable<SpanAttributes>({ secret: "content" });
    const status = unreadable<SpanStatus>({ status: "ok" });
    expect(() => span.addEvent("event", attributes)).not.toThrow();
    expect(() => span.setAttributes(attributes)).not.toThrow();
    expect(() => span.setStatus(status)).not.toThrow();
  });
}

describe("NOOP_TELEMETRY_CONTEXT", () => {
  it("admits callbacks synchronously and reuses one inert span", () =>
    Effect.runPromise(admitsNoopCallbacks));

  it("preserves synchronous and asynchronous rejection values", () =>
    Effect.runPromise(preservesNoopRejections));

  it("does not inspect or retain telemetry payloads", ignoreNoopPayloads);
});
