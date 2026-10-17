import { Effect } from "effect";
import { describe, expect, it } from "vite-plus/test";

import {
  type AiBinding,
  CLOUDFLARE_GATEWAY_BINDING_AUTH_SENTINEL,
  createAiBindingFetch,
} from "../src/api/cloudflare-ai-binding.ts";
import { streamSimple as streamOpenAICompletions } from "../src/api/openai-completions.ts";
import type { Model } from "../src/types.ts";
import { normalizeContext } from "../src/utils/transcript.ts";
import { encodeJson } from "./json-codec.ts";

const BINDING_PREFIX = "https://workers-binding.ai/ai-gateway/gateways/my-gateway";

function fakeBinding(response?: Response) {
  const requests: Request[] = [];
  const binding: AiBinding = {
    aiGatewayLogId: null,
    fetch: (input: Request | string | URL, init?: RequestInit) => {
      requests.push(input instanceof Request ? input : new Request(input, init));
      return Promise.resolve(response ?? new Response("{}"));
    },
  };
  return { binding, requests };
}

describe("createAiBindingFetch", () => {
  it("passes requests to the binding untouched", () =>
    Effect.runPromise(
      Effect.gen(function* () {
        const stream = new ReadableStream<Uint8Array>({
          start(controller) {
            controller.enqueue(new TextEncoder().encode("data: {}\n\n"));
            controller.close();
          },
        });
        const bindingResponse = new Response(stream, {
          headers: { "content-type": "text/event-stream", "cf-aig-log-id": "log-1" },
        });
        const { binding, requests } = fakeBinding(bindingResponse);
        const fetchFn = createAiBindingFetch(binding);
        const body = yield* encodeJson({
          model: "claude",
          messages: [{ role: "user", content: "hi" }],
        });

        const response = yield* Effect.promise(() =>
          fetchFn(`${BINDING_PREFIX}/anthropic/v1/messages?beta=true`, {
            method: "POST",
            headers: {
              "content-type": "application/json",
              "cf-aig-authorization": `Bearer ${CLOUDFLARE_GATEWAY_BINDING_AUTH_SENTINEL}`,
              "anthropic-version": "2023-06-01",
            },
            body,
          }),
        );

        const [request] = requests;
        if (request === undefined) throw new Error("Expected a binding request");
        expect(request.url).toBe(`${BINDING_PREFIX}/anthropic/v1/messages?beta=true`);
        expect(request.method).toBe("POST");
        expect(Object.fromEntries(request.headers)).toEqual({
          "content-type": "application/json",
          "cf-aig-authorization": `Bearer ${CLOUDFLARE_GATEWAY_BINDING_AUTH_SENTINEL}`,
          "anthropic-version": "2023-06-01",
        });
        expect(yield* Effect.promise(() => request.text())).toBe(body);
        expect(response).toBe(bindingResponse);
        expect(yield* Effect.promise(() => response.text())).toBe("data: {}\n\n");
      }),
    ));
});

describe("createAiBindingFetch", () => {
  it("rejects a binding with no fetch() at construction, not on first request", () => {
    expect(() => createAiBindingFetch({ aiGatewayLogId: null })).toThrow("does not expose fetch()");
  });
});

describe("createAiBindingFetch", () => {
  it("keeps SDK placeholder auth off the wire when paired with null auth headers", () =>
    Effect.runPromise(
      Effect.gen(function* () {
        const { binding, requests } = fakeBinding(
          Response.json({ error: { type: "bad_request", message: "stubbed" } }, { status: 400 }),
        );
        const model: Model<"openai-completions"> = {
          id: "test-model",
          name: "Test Model",
          api: "openai-completions",
          provider: "openai",
          baseUrl: `${BINDING_PREFIX}/openai`,
          reasoning: false,
          input: ["text"],
          cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
          contextWindow: 10_000,
          maxTokens: 1_000,
        };

        const result = yield* Effect.promise(() =>
          streamOpenAICompletions(
            model,
            normalizeContext({ messages: [{ role: "user", content: "hello", timestamp: 1 }] }),
            {
              headers: {
                "cf-aig-authorization": `Bearer ${CLOUDFLARE_GATEWAY_BINDING_AUTH_SENTINEL}`,
                Authorization: null,
                "x-api-key": null,
              },
              fetch: createAiBindingFetch(binding),
              maxRetries: 0,
            },
          ).result(),
        );

        expect(result.stopReason).toBe("error");
        expect(requests).toHaveLength(1);
        const [request] = requests;
        if (request === undefined) throw new Error("Expected a binding request");
        expect(request.url).toBe(`${BINDING_PREFIX}/openai/chat/completions`);
        const headerNames = Object.keys(Object.fromEntries(request.headers));
        expect(headerNames).not.toContain("authorization");
        expect(headerNames).not.toContain("x-api-key");
      }),
    ));
});
