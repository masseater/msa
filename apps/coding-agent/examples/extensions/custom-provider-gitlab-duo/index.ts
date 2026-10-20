import type { ExtensionAPI } from "@msa/coding-agent";

import { loginGitLab, refreshGitLabToken } from "./auth.ts";
import { MODELS } from "./config.ts";
import { streamGitLabDuo } from "./stream.ts";

export { MODELS, streamGitLabDuo };

export default function (msa: ExtensionAPI) {
  msa.registerProvider("gitlab-duo", {
    api: "gitlab-duo-api",
    apiKey: "$GITLAB_TOKEN",
    baseUrl: "https://cloud.gitlab.com",
    models: MODELS.map(
      ({ id, name, reasoning, thinkingLevelMap, input, cost, contextWindow, maxTokens }) =>
        Object.assign(
          { id, name, reasoning, input, cost, contextWindow, maxTokens },
          thinkingLevelMap === undefined ? {} : { thinkingLevelMap },
        ),
    ),
    oauth: {
      getApiKey: (cred) => cred.access,
      login: loginGitLab,
      name: "GitLab Duo",
      refreshToken: refreshGitLabToken,
    },
    streamSimple: streamGitLabDuo,
  });
}
