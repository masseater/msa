import { existsSync } from "node:fs";
import { delimiter, join } from "node:path";

import { Data, Effect } from "effect";

import { execCommand } from "../exec.ts";

export const LGTM_CONTAINER = "msa-grafana-lgtm";
export const LGTM_IMAGE = "docker.io/grafana/otel-lgtm:latest";
export const LGTM_OTLP_ENDPOINT = "http://localhost:4318";
export const GRAFANA_URL = "http://localhost:3000";

/** Ports published on localhost: Grafana, OTLP/HTTP, Tempo, Loki, and Prometheus. */
const PUBLISHED_PORTS = [3000, 4318, 3200, 3100, 9090] as const;

export class PodmanError extends Data.TaggedError("PodmanError")<{
  readonly message: string;
}> {}

export type ContainerState = "missing" | "running" | "stopped";

/** What to do with the existing container: use it, start it, or create it. */
export type LgtmAction = "reuse" | "start" | "run";

export function lgtmAction(state: ContainerState): LgtmAction {
  if (state === "running") return "reuse";
  return state === "stopped" ? "start" : "run";
}

export function findPodman(path: string | undefined): string | undefined {
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
    try: (signal) => execCommand(binary, [...args], process.cwd(), { signal }),
    catch: (error) => new PodmanError({ message: String(error) }),
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

/** Reads the state of `name` from `podman ps`. */
export function containerState(
  binary: string,
  name: string,
): Effect.Effect<ContainerState, PodmanError> {
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

/** `podman ps` fails when the podman machine (macOS, Windows) is not running. */
function reachablePodman(binary: string): Effect.Effect<ContainerState, PodmanError> {
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

/** Starts or creates the `msa-grafana-lgtm` container, reusing it when it already runs. */
export function ensureLgtm(binary: string): Effect.Effect<LgtmAction, PodmanError> {
  return Effect.gen(function* () {
    const action = lgtmAction(yield* reachablePodman(binary));
    if (action === "start") yield* podman(binary, ["start", LGTM_CONTAINER]);
    if (action === "run") yield* podman(binary, runArgs());
    return action;
  });
}
