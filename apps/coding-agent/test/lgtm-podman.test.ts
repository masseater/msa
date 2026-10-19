import { spawnSync } from "node:child_process";
import { randomUUID } from "node:crypto";

import { Effect } from "effect";
import { afterEach, describe, expect, it } from "vite-plus/test";

import { containerState, findPodman, lgtmAction } from "../src/core/observability/lgtm.ts";

const podman = findPodman(process.env["PATH"]);
const podmanRuns = podman !== undefined && spawnSync(podman, ["ps"]).status === 0;

/**
 * Reads real `podman ps` output. A pod's infra container gives a named container in each state
 * without pulling an image. CI has no podman, so these run only where podman answers `podman ps`.
 */
describe.skipIf(!podmanRuns)("msa-grafana-lgtm reuse decision against real podman", () => {
  const pods: string[] = [];

  afterEach(() => {
    for (const pod of pods.splice(0)) spawnSync(podman!, ["pod", "rm", "--force", pod]);
  });

  const state = (name: string) => Effect.runPromise(containerState(podman!, name));

  it("creates a missing container, starts a stopped one, and reuses a running one", async () => {
    const pod = `msa-test-${randomUUID().slice(0, 8)}`;
    const container = `${pod}-lgtm`;

    expect(lgtmAction(await state(container))).toBe("run");

    pods.push(pod);
    expect(
      spawnSync(podman!, ["pod", "create", "--name", pod, "--infra-name", container]).status,
    ).toBe(0);
    expect(await state(container)).toBe("stopped");
    expect(lgtmAction(await state(container))).toBe("start");

    expect(spawnSync(podman!, ["pod", "start", pod]).status).toBe(0);
    expect(await state(container)).toBe("running");
    expect(lgtmAction(await state(container))).toBe("reuse");
  });

  it("matches the container name exactly, not as a prefix", async () => {
    const pod = `msa-test-${randomUUID().slice(0, 8)}`;
    pods.push(pod);
    expect(
      spawnSync(podman!, ["pod", "create", "--name", pod, "--infra-name", `${pod}-lgtm-extra`])
        .status,
    ).toBe(0);

    expect(await state(`${pod}-lgtm`)).toBe("missing");
  });
});
