import compat from "@msa/ai/compat";
import testing from "@msa/testing";
import { Effect } from "effect";
import { describe, expect, it, vi } from "vite-plus/test";

import liveAuth from "./live-auth.ts";

const {
  ANTHROPIC_API_KEY_ENV,
  ANTHROPIC_AUTH_TOKEN_ENV,
  ANTHROPIC_FEDERATION_RULE_ID_ENV,
  ANTHROPIC_IDENTITY_TOKEN_FILE_ENV,
  ANTHROPIC_ORGANIZATION_ID_ENV,
  ANTHROPIC_SERVICE_ACCOUNT_ID_ENV,
  ANTHROPIC_WORKSPACE_ID_ENV,
} = compat;

const { liveAuthAvailable } = liveAuth;

const { runTest } = testing;

const ANTHROPIC_ENV = [
  ANTHROPIC_API_KEY_ENV,
  ANTHROPIC_AUTH_TOKEN_ENV,
  ANTHROPIC_FEDERATION_RULE_ID_ENV,
  ANTHROPIC_IDENTITY_TOKEN_FILE_ENV,
  ANTHROPIC_ORGANIZATION_ID_ENV,
  ANTHROPIC_SERVICE_ACCOUNT_ID_ENV,
  ANTHROPIC_WORKSPACE_ID_ENV,
];

const availableWithOnly = (values: Readonly<Record<string, string>>) =>
  Effect.gen(function* () {
    yield* Effect.sync(() => {
      for (const name of ANTHROPIC_ENV) vi.stubEnv(name, values[name]);
    });
    return yield* liveAuthAvailable;
  });

describe("live test auth", () => {
  it.each([
    ["ANTHROPIC_API_KEY", { [ANTHROPIC_API_KEY_ENV]: "api-key" }],
    ["ANTHROPIC_AUTH_TOKEN", { [ANTHROPIC_AUTH_TOKEN_ENV]: "auth-token" }],
    [
      "workload identity federation",
      {
        [ANTHROPIC_FEDERATION_RULE_ID_ENV]: "rule",
        [ANTHROPIC_IDENTITY_TOKEN_FILE_ENV]: "/run/identity-token",
        [ANTHROPIC_ORGANIZATION_ID_ENV]: "organization",
      },
    ],
  ])("runs with only %s", (_name, values) =>
    runTest(Effect.map(availableWithOnly(values), (available) => expect(available).toBe(true))),
  );

  it("skips without Anthropic auth", () =>
    runTest(Effect.map(availableWithOnly({}), (available) => expect(available).toBe(false))));
});
