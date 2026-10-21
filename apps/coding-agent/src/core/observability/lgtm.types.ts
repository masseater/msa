import type PodmanErrorClass from "./podman-error.ts";

declare namespace lgtmTypes {
  type ContainerState = "missing" | "running" | "stopped";

  type LgtmAction = "reuse" | "start" | "run";

  type PodmanError = (typeof PodmanErrorClass)["prototype"];
}

export type { lgtmTypes as default };
