import env from "./env.ts";

const { isEnvSet } = env;

function isTermuxSession(): boolean {
  return isEnvSet("TERMUX_VERSION");
}

const termuxSession = {
  isTermuxSession,
};

export default termuxSession;
