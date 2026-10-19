import * as Effect from "effect/Effect";

import { envSnapshot } from "../core/process-env.ts";
import { readText } from "./node-fs.ts";

export function isWSL(env: NodeJS.ProcessEnv = envSnapshot()): Promise<boolean> {
  if (
    (env["WSL_DISTRO_NAME"] !== undefined && env["WSL_DISTRO_NAME"] !== "") ||
    (env["WSLENV"] !== undefined && env["WSLENV"] !== "")
  ) {
    return Effect.runPromise(Effect.succeed(true));
  }

  return readText("/proc/version").then(
    (release) => /microsoft|wsl/iu.test(release),
    () => false,
  );
}
