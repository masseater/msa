import config from "../config.ts";
import userAgentModule from "../utils/user-agent.ts";
import platformModule from "./platform/index.ts";
import os from "./platform/node/os.ts";

const { VERSION } = config;
const { getMsaUserAgent } = userAgentModule;
const { envNames, readEnv } = platformModule;

function collectEnvironment() {
  const env = (name: string): string | null => readEnv(name) || null;
  return {
    arch: process.arch,
    osRelease: os.release(),
    osVersion: os.version(),
    piEnvironmentVariables: envNames()
      .filter((name) => name.startsWith("MSA_"))
      .sort(),
    platform: process.platform,
    runtime:
      process.versions["bun"] !== undefined && process.versions["bun"] !== ""
        ? `bun/${process.versions["bun"]}`
        : `node/${process.version}`,
    shell: readEnv("SHELL")?.split(/[\\/]/u).pop() || null,
    terminal: {
      ci: Boolean(readEnv("CI")),
      colorterm: env("COLORTERM"),
      program: env("TERM_PROGRAM"),
      programVersion: env("TERM_PROGRAM_VERSION"),
      ssh: Boolean(readEnv("SSH_CONNECTION") || readEnv("SSH_CLIENT") || readEnv("SSH_TTY")),
      term: env("TERM"),
      tmux: Boolean(readEnv("TMUX")),
    },
    userAgent: getMsaUserAgent(VERSION),
    version: VERSION,
  };
}

const bugReportEnvironment = { collectEnvironment };

export default bugReportEnvironment;
