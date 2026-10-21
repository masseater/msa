import type aiTypes from "@msa/ai/index.types";

import config from "../config.ts";
import paths from "../utils/paths.ts";
import text from "../utils/text.ts";
import platform from "./platform/index.ts";

const { getAuthPath } = config;
const { normalizePath } = paths;
const { stripBom } = text;
type AuthStorageData = Record<string, aiTypes.Credential>;
const credentialIn = (content: string, providerId: string): aiTypes.Credential | undefined => {
  try {
    return (JSON.parse(stripBom(content)) as AuthStorageData)[providerId];
  } catch {
    return undefined;
  }
};

function readStoredCredential(
  providerId: string,
  authPath: string = getAuthPath(),
): Promise<aiTypes.Credential | undefined> {
  return platform.files.readText(normalizePath(authPath)).then(
    (content) => credentialIn(content, providerId),
    () => undefined,
  );
}

const authStorageSupport = {
  readStoredCredential,
};

export default authStorageSupport;
