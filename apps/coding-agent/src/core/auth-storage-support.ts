import type aiTypes from "@msa/ai/index.types";

import config from "../config.ts";
import paths from "../utils/paths.ts";
import text from "../utils/text.ts";
import platformNode from "./platform-node.ts";
import nodeFs from "./platform/node/fs.ts";

const { readFileSync } = nodeFs;
const { join } = platformNode;
const { getAgentDir } = config;
const { normalizePath } = paths;
const { stripBom } = text;
type AuthStorageData = Record<string, aiTypes.Credential>;
function readStoredCredential(
  providerId: string,
  authPath: string = join(getAgentDir(), "auth.json"),
): aiTypes.Credential | undefined {
  try {
    const data = JSON.parse(
      stripBom(readFileSync(normalizePath(authPath), "utf-8")),
    ) as AuthStorageData;
    return data[providerId];
  } catch {
    return undefined;
  }
}

const authStorageSupport = {
  readStoredCredential,
};

export default authStorageSupport;
