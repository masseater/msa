import type { ModelsPublication, ModelsStoreEntry } from "@msa/ai";
import testing from "@msa/testing";
import { Effect, Schema } from "effect";

import type { createLlamaProvider } from "../src/extensions/llama/provider.ts";
import type llamaExtensionSupportTypes from "./llama-extension-support.types.ts";

const { abortController, awaited, listen, readBody, runTest, toJsonText } = testing;

const decodeRecord = Schema.decodeUnknownEffect(
  Schema.fromJsonString(Schema.Record(Schema.String, Schema.Unknown)),
);

const respond = (value: unknown): Response =>
  value instanceof Response
    ? value
    : value === undefined
      ? new Response(null, { status: 404 })
      : Response.json(value);

const serve = (route: llamaExtensionSupportTypes.Route) =>
  listen((request) =>
    Effect.gen(function* () {
      const url = new URL(request.url);
      const body = request.method === "GET" ? "" : yield* readBody(request);
      const json = body === "" ? {} : yield* decodeRecord(body);
      return respond(
        route({
          headers: request.headers,
          json,
          method: request.method,
          path: `${url.pathname}${url.search}`,
          url,
        }),
      );
    }),
  );

const eventStream = () => {
  const streams = new Set<ReadableStreamDefaultController<Uint8Array>>();
  const encoder = new TextEncoder();
  const send = (event: unknown) =>
    Effect.gen(function* () {
      const chunk = encoder.encode(`data: ${yield* toJsonText(event)}\n\n`);
      for (const controller of streams) controller.enqueue(chunk);
    });
  const response = () => {
    let owned: ReadableStreamDefaultController<Uint8Array> | undefined;
    return new Response(
      new ReadableStream<Uint8Array>({
        cancel: () => {
          if (owned !== undefined) streams.delete(owned);
        },
        start: (controller) => {
          owned = controller;
          streams.add(controller);
        },
      }),
      { headers: { "Content-Type": "text/event-stream" } },
    );
  };
  return { response, send };
};

const later = (delayMs: number, effect: Effect.Effect<void>): void => {
  Effect.runFork(Effect.sleep(delayMs).pipe(Effect.andThen(effect)));
};

const createCache = () => {
  let entry: ModelsStoreEntry | undefined;
  const publish = (publication: ModelsPublication): Promise<boolean> =>
    runTest(
      Effect.sync(() => {
        if (publication.persist === null) entry = undefined;
        else if (publication.persist !== undefined) entry = structuredClone(publication.persist);
        publication.update?.();
        return true;
      }),
    );
  return { entry: () => entry, publish };
};

const localCredential = (url: string) => ({
  env: { LLAMA_BASE_URL: url },
  key: "local",
  type: "api_key" as const,
});

const refresh = (
  controller: ReturnType<typeof createLlamaProvider>,
  options: llamaExtensionSupportTypes.RefreshOptions,
) =>
  awaited(
    controller.provider.refreshModels?.({
      allowNetwork: options.allowNetwork ?? true,
      credential: localCredential(options.url),
      publish: options.publish ?? createCache().publish,
      signal: abortController().signal,
      stored: options.stored,
    }),
  );

const llamaExtensionSupport = {
  createCache,
  eventStream,
  later,
  localCredential,
  refresh,
  serve,
};

export default llamaExtensionSupport;
