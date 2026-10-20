import type agentTypes from "@msa/agent-core/index.types";
import type compatTypes from "@msa/ai/compat.types";

import mcpServers from "./mcp-servers.ts";
import messagesModule from "./messages.ts";
import type sdkTypes from "./sdk.types.ts";
import SettingsManager from "./settings-manager.ts";

const { createToolNameMatcher } = mcpServers;
const { convertToLlm } = messagesModule;

function createAgentSessionPart1(
  options: sdkTypes.CreateAgentSessionOptions,
  selectedToolNames: string[] | undefined,
  defaultToolNames: readonly string[],
  settingsManager: SettingsManager,
) {
  const { excludedToolNames, initialActiveToolNames } = createAgentSessionPart1Part3(
    options,
    selectedToolNames,
    defaultToolNames,
  );

  const convertToLlmWithBlockImages = (
    messages: agentTypes.AgentMessage[],
  ): compatTypes.Message[] => {
    const converted = convertToLlm(messages);
    if (!settingsManager.getBlockImages()) {
      return converted;
    }
    return converted.map((msg) => {
      if (msg.role === "user" || msg.role === "toolResult") {
        const content = msg.content;
        if (Array.isArray(content)) {
          const hasImages = content.some((c) => c.type === "image");
          if (hasImages) {
            const filteredContent = content
              .map((c) =>
                c.type === "image"
                  ? { text: "Image reading is disabled.", type: "text" as const }
                  : c,
              )
              .filter(
                (c, i, arr) =>
                  !(
                    c.type === "text" &&
                    c.text === "Image reading is disabled." &&
                    i > 0 &&
                    arr[i - 1]?.type === "text" &&
                    (arr[i - 1] as { type: "text"; text: string }).text ===
                      "Image reading is disabled."
                  ),
              );
            return Object.assign({}, msg, { content: filteredContent });
          }
        }
      }
      return msg;
    });
  };
  return { convertToLlmWithBlockImages, excludedToolNames, initialActiveToolNames };
}

function createAgentSessionPart1Part3(
  options: sdkTypes.CreateAgentSessionOptions,
  selectedToolNames: string[] | undefined,
  defaultToolNames: readonly string[],
): { excludedToolNames: any; initialActiveToolNames: any } {
  return createAgentSessionPart1Part2(options, selectedToolNames, defaultToolNames);
}

function createAgentSessionPart1Part2(
  options: sdkTypes.CreateAgentSessionOptions,
  selectedToolNames: string[] | undefined,
  defaultToolNames: readonly string[],
): { excludedToolNames: any; initialActiveToolNames: any } {
  return createAgentSessionPart1Part1(options, selectedToolNames, defaultToolNames);
}

function createAgentSessionPart1Part1(
  options: sdkTypes.CreateAgentSessionOptions,
  selectedToolNames: string[] | undefined,
  defaultToolNames: readonly string[],
) {
  const excludedToolNames = options.excludeTools;
  const isExcludedTool =
    excludedToolNames === undefined ? undefined : createToolNameMatcher(excludedToolNames);
  const initialActiveToolNames = (selectedToolNames ?? defaultToolNames).filter(
    (name) => isExcludedTool?.(name) !== true,
  );
  return { excludedToolNames, initialActiveToolNames };
}

const sdkPart3 = {
  createAgentSessionPart1,
};

export default sdkPart3;
