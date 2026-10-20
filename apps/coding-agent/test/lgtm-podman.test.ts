import testing from "@msa/testing";
import { Effect } from "effect";
import { ChildProcess } from "effect/process";
import { type TestContext, afterEach, describe, expect, it } from "vite-plus/test";

import lgtm from "../src/core/observability/lgtm.ts";
import processEnv from "../src/core/process-env.ts";

const { containerState, findPodman, lgtmAction } = lgtm;
const { readEnv } = processEnv;

const { provideNode, randomSuffix, runTest } = testing;

const podman = findPodman(readEnv("PATH"));

const pods: string[] = [];

const runPodman = (args: string[]) =>
  podman === undefined
    ? Effect.succeed(-1)
    : provideNode(
        Effect.scoped(
          Effect.flatMap(
            ChildProcess.make(podman, args, {
              stderr: "ignore",
              stdin: "ignore",
              stdout: "ignore",
            }),
            (handle) => handle.exitCode,
          ),
        ),
      ).pipe(
        Effect.map(Number),
        Effect.orElseSucceed(() => -1),
      );

const state = (name: string) => containerState(podman ?? "", name);

const newPod = Effect.map(randomSuffix, (suffix) => `msa-test-${suffix.slice(0, 8)}`);

const withPodman = <E>(context: TestContext, body: Effect.Effect<void, E>) =>
  runTest(
    Effect.gen(function* () {
      if ((yield* runPodman(["ps"])) !== 0) context.skip();
      yield* body;
    }),
  );

const createsAMissingContainerStartsAStopped = Effect.gen(function* () {
  const pod = yield* newPod;
  const container = `${pod}-lgtm`;
  expect(lgtmAction(yield* state(container))).toBe("run");
  pods.push(pod);
  expect(yield* runPodman(["pod", "create", "--name", pod, "--infra-name", container])).toBe(0);
  expect(yield* state(container)).toBe("stopped");
  expect(lgtmAction(yield* state(container))).toBe("start");
  expect(yield* runPodman(["pod", "start", pod])).toBe(0);
  expect(yield* state(container)).toBe("running");
  expect(lgtmAction(yield* state(container))).toBe("reuse");
});

const matchesTheContainerNameExactlyNotAs = Effect.gen(function* () {
  const pod = yield* newPod;
  pods.push(pod);
  expect(
    yield* runPodman(["pod", "create", "--name", pod, "--infra-name", `${pod}-lgtm-extra`]),
  ).toBe(0);
  expect(yield* state(`${pod}-lgtm`)).toBe("missing");
});

describe("msa-grafana-lgtm reuse decision against real podman", () => {
  afterEach(() =>
    runTest(
      Effect.forEach(pods.splice(0), (pod) => runPodman(["pod", "rm", "--force", pod]), {
        discard: true,
      }),
    ),
  );

  it("creates a missing container, starts a stopped one, and reuses a running one", (context) =>
    withPodman(context, createsAMissingContainerStartsAStopped));

  it("matches the container name exactly, not as a prefix", (context) =>
    withPodman(context, matchesTheContainerNameExactlyNotAs));
});
