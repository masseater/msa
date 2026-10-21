import * as Effect from "effect/Effect";

import platform from "../core/platform/index.ts";

const { envSnapshot } = platform;
const { readText } = platform.files;

function isWSL(env: NodeJS.ProcessEnv = envSnapshot()): Promise<boolean> {
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

const wsl = {
  isWSL,
};

export default wsl;
