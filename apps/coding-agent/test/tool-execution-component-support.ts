import testing from "@msa/testing";
import type tuiTypes from "@msa/tui/index.types";
import { Type } from "typebox";

import type extensionsTypesTypes from "../src/core/extensions/types.types.ts";

const { awaited, runTest } = testing;

function createBaseToolDefinition(name = "custom_tool"): extensionsTypesTypes.ToolDefinition {
  return {
    description: "custom tool",
    execute: () =>
      runTest(
        awaited({
          content: [{ text: "ok", type: "text" as const }],
          details: {},
        }),
      ),
    label: name,
    name,
    parameters: Type.Any(),
  };
}

const TINY_JPEG =
  "/9j/4AAQSkZJRgABAQAAAQABAAD/2wBDAAMCAgMCAgMDAwMEAwMEBQgFBQQEBQoHBwYIDAoMDAsKCwsNDhIQDQ4RDgsLEBYQERMUFRUVDA8XGBYUGBIUFRT/2wBDAQMEBAUEBQkFBQkUDQsNFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBT/wAARCAACAAIDAREAAhEBAxEB/8QAFAABAAAAAAAAAAAAAAAAAAAACf/EABQQAQAAAAAAAAAAAAAAAAAAAAD/xAAVAQEBAAAAAAAAAAAAAAAAAAAGCf/EABQRAQAAAAAAAAAAAAAAAAAAAAD/2gAMAwEAAhEDEQA/AD3VTB3/2Q==";

function createFakeTui(): tuiTypes.TUI {
  return {
    requestRender: () => {},
  } as unknown as tuiTypes.TUI;
}

const toolExecutionComponentSupport = {
  TINY_JPEG,
  createBaseToolDefinition,
  createFakeTui,
};

export default toolExecutionComponentSupport;
