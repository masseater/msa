import type contentTypes from "./content.types.ts";

function blockToLlmContent(block: contentTypes.ContentBlock): contentTypes.LlmContent {
  switch (block.type) {
    case "text":
      return { text: block.text, type: "text" };
    case "image":
      return { data: block.data, mimeType: block.mimeType, type: "image" };
    case "audio":
      return { text: `[audio ${block.mimeType} omitted]`, type: "text" };
    case "resource_link":
      return { text: `${block.name}: ${block.uri}`, type: "text" };
    case "resource": {
      const resource = block.resource;
      if ("text" in resource) return { text: resource.text, type: "text" };
      if (resource.mimeType?.startsWith("image/") === true) {
        return { data: resource.blob, mimeType: resource.mimeType, type: "image" };
      }
      return {
        text: `[binary resource ${resource.uri} (${resource.mimeType ?? "unknown type"}) omitted]`,
        type: "text",
      };
    }
    default:
      return {
        text: `[unsupported MCP content ${(block as { type: string }).type}]`,
        type: "text",
      };
  }
}

function toLlmContent(
  result: Pick<contentTypes.CallToolResult, "content" | "structuredContent">,
): contentTypes.LlmContent[] {
  const content = (result.content ?? []).map(blockToLlmContent);
  if (content.length === 0 && result.structuredContent !== undefined) {
    content.push({ text: JSON.stringify(result.structuredContent, null, 2), type: "text" });
  }
  return content;
}

const contentModule = {
  toLlmContent,
};

export default contentModule;
