import * as Effect from "effect/Effect";

import processEnv from "../core/process-env.ts";
import nodeFs from "./node-fs.ts";

const { envSnapshot } = processEnv;
const { readText } = nodeFs;

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
