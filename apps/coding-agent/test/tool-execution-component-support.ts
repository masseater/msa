import testing from "@msa/testing";
import type tuiTypes from "@msa/tui/index.types";
import { Type } from "typebox";

import type extensionsTypesTypes from "../src/core/extensions/types.types.ts";
import ToolExecutionComponent from "../src/modes/interactive/components/tool-execution.ts";
import ansi from "../src/utils/ansi.ts";

const { stripAnsi } = ansi;

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

type ComponentParameters = ConstructorParameters<typeof ToolExecutionComponent>;

const createToolComponent = (
  name: ComponentParameters[0],
  id: ComponentParameters[1],
  args: ComponentParameters[2],
  definition: ComponentParameters[4],
): ToolExecutionComponent =>
  new ToolExecutionComponent(name, id, args, {}, definition, createFakeTui(), process.cwd());

const renderedText = (component: ToolExecutionComponent, width = 120): string =>
  stripAnsi(component.render(width).join("\n"));

const toolExecutionComponentSupport = {
  TINY_JPEG,
  createBaseToolDefinition,
  createFakeTui,
  createToolComponent,
  renderedText,
};

export default toolExecutionComponentSupport;
