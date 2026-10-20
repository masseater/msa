import { Effect } from "effect";

import exec from "../exec.ts";
import nodeFs from "../platform/node/fs.ts";
import nodePath from "../platform/node/path.ts";
import type lgtmTypes from "./lgtm.types.ts";
import PodmanError from "./podman-error.ts";

const { existsSync } = nodeFs;
const { delimiter, join } = nodePath;
const { execCommand } = exec;

const LGTM_CONTAINER = "msa-grafana-lgtm";
const LGTM_IMAGE = "docker.io/grafana/otel-lgtm:latest";
const LGTM_OTLP_ENDPOINT = "http://localhost:4318";
const GRAFANA_URL = "http://localhost:3000";
const PUBLISHED_PORTS = [3000, 4318, 3200, 3100, 9090] as const;
function lgtmAction(state: lgtmTypes.ContainerState): lgtmTypes.LgtmAction {
  if (state === "running") return "reuse";
  return state === "stopped" ? "start" : "run";
}
function findPodman(path: string | undefined): string | undefined {
  const names = process.platform === "win32" ? ["podman.exe"] : ["podman"];
  for (const directory of (path ?? "").split(delimiter)) {
    if (directory === "") continue;
    for (const name of names) {
      const candidate = join(directory, name);
      if (existsSync(candidate)) return candidate;
    }
  }
  return undefined;
}
function podman(binary: string, args: readonly string[]): Effect.Effect<string, PodmanError> {
  return Effect.tryPromise({
    catch: (error) => new PodmanError({ message: String(error) }),
    try: (signal) => execCommand(binary, [...args], process.cwd(), { signal }),
  }).pipe(
    Effect.flatMap((result) =>
      result.code === 0
        ? Effect.succeed(result.stdout)
        : Effect.fail(
            new PodmanError({
              message: `podman ${args[0]} failed: ${(result.stderr || result.stdout).trim().split("\n", 1)[0]}`,
            }),
          ),
    ),
  );
}
function containerState(
  binary: string,
  name: string,
): Effect.Effect<lgtmTypes.ContainerState, PodmanError> {
  return podman(binary, [
    "ps",
    "--all",
    "--filter",
    `name=^${name}$`,
    "--format",
    "{{.State}}",
  ]).pipe(
    Effect.map((stdout) => {
      const state = stdout.trim().split("\n", 1)[0]?.trim() ?? "";
      if (state === "") return "missing";
      return state === "running" ? "running" : "stopped";
    }),
  );
}
function reachablePodman(binary: string): Effect.Effect<lgtmTypes.ContainerState, PodmanError> {
  return containerState(binary, LGTM_CONTAINER).pipe(
    Effect.catch(() =>
      podman(binary, ["machine", "start"]).pipe(
        Effect.ignore,
        Effect.andThen(containerState(binary, LGTM_CONTAINER)),
      ),
    ),
  );
}
function runArgs(): string[] {
  return [
    "run",
    "--detach",
    "--name",
    LGTM_CONTAINER,
    "--init",
    ...PUBLISHED_PORTS.flatMap((port) => ["--publish", `127.0.0.1:${port}:${port}`]),
    "--volume",
    `${LGTM_CONTAINER}:/data`,
    "--env",
    "GF_PATHS_DATA=/data/grafana",
    LGTM_IMAGE,
  ];
}
function ensureLgtm(binary: string): Effect.Effect<lgtmTypes.LgtmAction, PodmanError> {
  return Effect.gen(function* () {
    const action = lgtmAction(yield* reachablePodman(binary));
    if (action === "start") yield* podman(binary, ["start", LGTM_CONTAINER]);
    if (action === "run") yield* podman(binary, runArgs());
    return action;
  });
}

const lgtm = {
  GRAFANA_URL,
  LGTM_CONTAINER,
  LGTM_IMAGE,
  LGTM_OTLP_ENDPOINT,
  containerState,
  ensureLgtm,
  findPodman,
  lgtmAction,
};

export default lgtm;
