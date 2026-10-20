import type codingAgentTypes from "@msa/coding-agent/index.types";

import auth from "./auth.ts";
import config from "./config.ts";
import stream from "./stream.ts";

const { MODELS } = config;
const { loginGitLab, refreshGitLabToken } = auth;
const { streamGitLabDuo } = stream;

export default function (msa: codingAgentTypes.ExtensionAPI) {
  msa.registerProvider("gitlab-duo", {
    api: "gitlab-duo-api",
    apiKey: "$GITLAB_TOKEN",
    baseUrl: "https://cloud.gitlab.com",
    models: MODELS.map(
      ({ id, name, reasoning, thinkingLevelMap, input, cost, contextWindow, maxTokens }) =>
        Object.assign(
          { contextWindow, cost, id, input, maxTokens, name, reasoning },
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
