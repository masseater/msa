const stringProperty = (description: string) => ({ description, type: "string" });

const SERVER_FILTER = stringProperty("MCP server name. Omit to list every server with resources.");

const CURSOR = stringProperty(
  "Opaque cursor from a previous call with the same server; omit for the first page.",
);

const LIST_PARAMETERS = {
  additionalProperties: false,
  properties: { cursor: CURSOR, server: SERVER_FILTER },
  type: "object",
};

const READ_PARAMETERS = {
  additionalProperties: false,
  properties: {
    server: stringProperty(
      "MCP server name exactly as configured. Must match the 'server' field returned by list_mcp_resources.",
    ),
    uri: stringProperty(
      "Resource URI to read. Must be one of the URIs returned by list_mcp_resources.",
    ),
  },
  required: ["server", "uri"],
  type: "object",
};

const optionalString = { type: "string" };

const LISTING_ERRORS = {
  description: "Servers that could not be listed",
  items: {
    properties: { error: { type: "string" }, server: { type: "string" } },
    required: ["server", "error"],
    type: "object",
  },
  type: "array",
};

const LIST_OUTPUT_SCHEMA = {
  properties: {
    errors: LISTING_ERRORS,
    nextCursor: optionalString,
    resources: {
      items: {
        properties: {
          description: optionalString,
          mimeType: optionalString,
          name: { type: "string" },
          server: { type: "string" },
          size: { type: "number" },
          title: optionalString,
          uri: { type: "string" },
        },
        required: ["server", "uri", "name"],
        type: "object",
      },
      type: "array",
    },
    server: optionalString,
  },
  required: ["resources"],
  type: "object",
};

const LIST_TEMPLATES_OUTPUT_SCHEMA = {
  properties: {
    errors: LISTING_ERRORS,
    nextCursor: optionalString,
    resourceTemplates: {
      items: {
        properties: {
          description: optionalString,
          mimeType: optionalString,
          name: { type: "string" },
          server: { type: "string" },
          title: optionalString,
          uriTemplate: { description: "RFC 6570 URI template", type: "string" },
        },
        required: ["server", "uriTemplate", "name"],
        type: "object",
      },
      type: "array",
    },
    server: optionalString,
  },
  required: ["resourceTemplates"],
  type: "object",
};

const READ_OUTPUT_SCHEMA = {
  properties: {
    contents: {
      items: {
        anyOf: [
          {
            properties: {
              mimeType: optionalString,
              text: { type: "string" },
              uri: { type: "string" },
            },
            required: ["uri", "text"],
            type: "object",
          },
          {
            properties: {
              blob: { description: "base64", type: "string" },
              mimeType: optionalString,
              uri: { type: "string" },
            },
            required: ["uri", "blob"],
            type: "object",
          },
        ],
      },
      type: "array",
    },
    server: { type: "string" },
    uri: { type: "string" },
  },
  required: ["server", "uri", "contents"],
  type: "object",
};

const resourceSchemas = {
  LIST_OUTPUT_SCHEMA,
  LIST_PARAMETERS,
  LIST_TEMPLATES_OUTPUT_SCHEMA,
  READ_OUTPUT_SCHEMA,
  READ_PARAMETERS,
};

export default resourceSchemas;
