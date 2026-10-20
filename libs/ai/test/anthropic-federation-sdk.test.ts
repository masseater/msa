import * as NodeServices from "@effect/platform-node/NodeServices";
import { Effect, FileSystem, ManagedRuntime, Path } from "effect";
import { afterEach, describe, expect, it, vi } from "vite-plus/test";

import anthropicMessages from "../src/api/anthropic-messages.ts";
import type typesModule from "../src/types.types.ts";
import clock from "../src/utils/clock.ts";
import transcript from "../src/utils/transcript.ts";
import anthropicSseParsingSupport from "./anthropic-sse-parsing-support.ts";

const { normalizeContext } = transcript;
const { currentTimeMillis } = clock;
const { stream: streamAnthropic } = anthropicMessages;

const { createSseResponse } = anthropicSseParsingSupport;

const runtime = ManagedRuntime.make(NodeServices.layer);

interface RecordedRequest {
  path: string;
  authorization: string | null;
}

const endTurnResponse = () =>
  createSseResponse([
    {
      data: {
        message: { id: "msg_test", usage: { input_tokens: 1, output_tokens: 0 } },
        type: "message_start",
      },
      event: "message_start",
    },
    {
      data: {
        delta: { stop_reason: "end_turn" },
        type: "message_delta",
        usage: { output_tokens: 1 },
      },
      event: "message_delta",
    },
    { data: { type: "message_stop" }, event: "message_stop" },
  ]);

const recordingFetch =
  (requests: RecordedRequest[]): typeof globalThis.fetch =>
  (input, init) => {
    const request = new Request(input, init);
    const path = new URL(request.url).pathname;
    requests.push({ authorization: request.headers.get("authorization"), path });
    return Promise.resolve(
      path === "/v1/oauth/token"
        ? Response.json({ access_token: "federated-token", expires_in: 3600 })
        : endTurnResponse(),
    );
  };

const context = normalizeContext({
  messages: [{ content: "Hello", role: "user", timestamp: currentTimeMillis() }],
  systemPrompt: "System prompt.",
});

const anthropicModel: typesModule.Model<"anthropic-messages"> = {
  api: "anthropic-messages",
  baseUrl: "https://api.anthropic.com",
  contextWindow: 100000,
  cost: { cacheRead: 0, cacheWrite: 0, input: 0, output: 0 },
  id: "claude-test",
  input: ["text"],
  maxTokens: 4096,
  name: "Claude Test",
  provider: "anthropic-api",
  reasoning: false,
};

const federationEnv = Effect.gen(function* () {
  const fs = yield* FileSystem.FileSystem;
  const path = yield* Path.Path;
  const directory = yield* fs.makeTempDirectoryScoped({ prefix: "msa-anthropic-federation-" });
  const identityTokenFile = path.join(directory, "identity.jwt");
  yield* fs.writeFileString(identityTokenFile, "header.payload.signature");
  return {
    ANTHROPIC_FEDERATION_RULE_ID: "fdrl_test",
    ANTHROPIC_IDENTITY_TOKEN_FILE: identityTokenFile,
    ANTHROPIC_ORGANIZATION_ID: "org-test",
  };
});

const exchangesIdentityTokenOnce = () =>
  runtime.runPromise(
    Effect.scoped(
      Effect.gen(function* () {
        const env = yield* federationEnv;
        const requests: RecordedRequest[] = [];
        const fetch = recordingFetch(requests);
        const messages = yield* Effect.forEach([1, 2, 3], () =>
          Effect.promise(() => streamAnthropic(anthropicModel, context, { env, fetch }).result()),
        );
        expect(messages.map((message) => message.stopReason)).toEqual(["stop", "stop", "stop"]);
        expect(requests.filter((request) => request.path === "/v1/oauth/token")).toHaveLength(1);
        expect(
          requests.filter((request) => request.path === "/v1/messages").map((r) => r.authorization),
        ).toEqual(Array.from({ length: 3 }, () => "Bearer federated-token"));
      }),
    ),
  );

const skipsCredentialChainForHeaderAuth = () =>
  runtime.runPromise(
    Effect.scoped(
      Effect.gen(function* () {
        for (const [name, value] of Object.entries(yield* federationEnv)) vi.stubEnv(name, value);
        const requests: RecordedRequest[] = [];
        const message = yield* Effect.promise(() =>
          streamAnthropic(anthropicModel, context, {
            fetch: recordingFetch(requests),
            headers: { Authorization: "Bearer auth-token" },
          }).result(),
        );
        expect(message.stopReason).toBe("stop");
        expect(requests).toEqual([{ authorization: "Bearer auth-token", path: "/v1/messages" }]);
      }),
    ),
  );

describe("Anthropic workload identity federation with the SDK", () => {
  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it("exchanges the identity token once across requests", exchangesIdentityTokenOnce);
  it(
    "does not run the SDK credential chain for header-owned auth",
    skipsCredentialChainForHeaderAuth,
  );
});
