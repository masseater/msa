import * as Effect from "effect/Effect";

import { readText } from "./node-fs.ts";

export function isWSL(env: NodeJS.ProcessEnv = process.env): Promise<boolean> {
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
