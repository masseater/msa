import type { ExtensionAPI } from "@msa/coding-agent";

import { loginGitLab, refreshGitLabToken } from "./auth.ts";
import { MODELS } from "./config.ts";
import { streamGitLabDuo } from "./stream.ts";

export { MODELS, streamGitLabDuo };

export default function (msa: ExtensionAPI) {
  msa.registerProvider("gitlab-duo", {
    baseUrl: "https://cloud.gitlab.com",
    apiKey: "$GITLAB_TOKEN",
    api: "gitlab-duo-api",
    models: MODELS.map(
      ({ id, name, reasoning, thinkingLevelMap, input, cost, contextWindow, maxTokens }) =>
        Object.assign(
          { id, name, reasoning, input, cost, contextWindow, maxTokens },
          thinkingLevelMap === undefined ? {} : { thinkingLevelMap },
        ),
    ),
    oauth: {
      name: "GitLab Duo",
      login: loginGitLab,
      refreshToken: refreshGitLabToken,
      getApiKey: (cred) => cred.access,
    },
    streamSimple: streamGitLabDuo,
  });
}
