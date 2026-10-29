import testing from "@msa/testing";
import { Effect } from "effect";
import { describe, expect, it } from "vite-plus/test";

import memoryStartupSupport from "./memory-startup-support.ts";

const { runTest } = testing;
const { useAgents } = memoryStartupSupport;

const setUp = useAgents();

const SKIPPED = "Memory recall skipped:";
const PROMPT = "where does the release go?";

const skippedRecall = (options: Parameters<typeof setUp>[0], reason: string) =>
  Effect.gen(function* () {
    const agent = yield* setUp(options);
    const result = yield* agent.prompt(PROMPT);
    expect(result.code, result.stderr).toBe(0);
    expect(result.stdout).toBe("memory check done\n");
    const lines = result.stderr.split("\n").filter((line) => line.includes(SKIPPED));
    expect(lines, result.stderr).toHaveLength(1);
    expect(lines[0]).toContain(reason);
    const [request = ""] = agent.model.bodies;
    expect(request).not.toContain("Releases go to the tap.");
    expect(agent.sepiace.memoryRequests).toEqual([]);
  });

const notSignedIn = skippedRecall(
  { signedIn: false },
  "not signed in; sign in with /memory or msa memory login",
);

const tokenRejected = skippedRecall(
  { signedIn: true, tokenRejected: true },
  "sepiace rejected the saved sign-in; sign in with /memory or msa memory login",
);

const storeUnreadable = skippedRecall(
  { signedIn: true, storeFails: true },
  "could not read the saved sign-in: ",
);

const sepiaceUnreachable = skippedRecall(
  { sepiaceDown: true, signedIn: true },
  "failed to connect",
);

const sepiaceNeverAnswers = skippedRecall(
  { sepiaceHangs: true, signedIn: true },
  "sepiace did not answer within 5 seconds",
);

const statusSaysTheSavedSignInWasRejected = Effect.gen(function* () {
  const agent = yield* setUp({ signedIn: true, tokenRejected: true });
  const status = yield* agent.run(["memory", "status"]);
  expect(status.stdout).toContain("sepiace rejected the saved sign-in");
  expect(status.stdout).not.toContain("not signed in");
});

const saysNothingWhenMemoryIsOffOrRecalls = Effect.gen(function* () {
  const off = yield* setUp({ memory: { enabled: false }, signedIn: false });
  const offResult = yield* off.prompt(PROMPT);
  expect(offResult.code, offResult.stderr).toBe(0);
  expect(offResult.stderr).not.toContain(SKIPPED);
  const recallOff = yield* setUp({ memory: { recall: { enabled: false } }, signedIn: false });
  const recallOffResult = yield* recallOff.prompt(PROMPT);
  expect(recallOffResult.stderr).not.toContain(SKIPPED);
  const working = yield* setUp({ signedIn: true });
  const workingResult = yield* working.prompt(PROMPT);
  expect(workingResult.code, workingResult.stderr).toBe(0);
  expect(workingResult.stderr).not.toContain(SKIPPED);
});

describe.skipIf(process.platform === "win32")("msa -p when long-term memory is skipped", () => {
  it("says why when sepiace is not signed in", () => runTest(notSignedIn), 90_000);
  it("says why when sepiace rejects the saved token", () => runTest(tokenRejected), 90_000);
  it("says why when the credential store cannot be read", () => runTest(storeUnreadable), 90_000);
  it("says why when sepiace is unreachable", () => runTest(sepiaceUnreachable), 90_000);
  it("says why when sepiace does not answer in time", () => runTest(sepiaceNeverAnswers), 90_000);
  it(
    "says nothing when memory is off, recall is off, or recall works",
    () => runTest(saysNothingWhenMemoryIsOffOrRecalls),
    90_000,
  );
  it(
    "reports a rejected saved sign-in in msa memory status",
    () => runTest(statusSaysTheSavedSignInWasRejected),
    90_000,
  );
});
