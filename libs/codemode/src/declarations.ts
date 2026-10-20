import { dual } from "effect/Function";

import type declarationsTypes from "./declarations.types.ts";
import bridge from "./runtime/bridge.ts";
import schemaType from "./schema-type.ts";
import type typesModule from "./types.ts";

const { schemaToType, schemaToTypeWithin } = schemaType;
const { toCodemodeIdentifier } = bridge;

const INDENT = "  ";
const DEFAULT_INPUT_SCHEMA_MAX_CHARS = 16_000;

type SignatureTool = Pick<typesModule.CodemodeTool, "name" | "inputSchema" | "outputSchema">;
type SampleTool = Pick<
  typesModule.CodemodeTool,
  "name" | "description" | "inputSchema" | "outputSchema"
>;

function docComment(description: string | undefined, indent: string): string {
  const text = description?.trim();
  if (text === undefined || text === "") return "";
  const lines = text.replaceAll("*/", "*\\/").split(/\r?\n/u);
  if (lines.length === 1) return `${indent}/** ${lines[0]} */\n`;
  return `${indent}/**\n${lines.map((line) => `${indent} *${line === "" ? "" : ` ${line}`}`).join("\n")}\n${indent} */\n`;
}

function renderToolOutputType(schema: typesModule.CodemodeJsonSchema | undefined): string {
  return schema === undefined ? "unknown" : schemaToType(schema);
}

const isTool = (args: IArguments | readonly unknown[]): boolean => {
  const first: unknown = args[0];
  return typeof first === "object" && first !== null && "name" in first;
};

const signatureOf = (
  tool: SignatureTool,
  options: declarationsTypes.RenderToolOptions = {},
): string => {
  const input =
    tool.inputSchema === undefined
      ? "unknown"
      : schemaToTypeWithin(
          tool.inputSchema,
          options.inputMaxChars ?? DEFAULT_INPUT_SCHEMA_MAX_CHARS,
        );
  return `${toCodemodeIdentifier(tool.name)}(args: ${input}): Promise<${renderToolOutputType(tool.outputSchema)}>;`;
};

const renderToolSignature: {
  (options?: declarationsTypes.RenderToolOptions): (tool: SignatureTool) => string;
  (tool: SignatureTool, options?: declarationsTypes.RenderToolOptions): string;
} = dual(isTool, signatureOf);

const sampleOf = (tool: SampleTool, options: declarationsTypes.RenderToolOptions = {}): string => {
  const declaration = `declare const tools: { ${signatureOf(tool, options)} };`;
  return `${tool.description?.trim() ?? ""}\n\ncodemode tool declaration:\n\`\`\`ts\n${declaration}\n\`\`\``;
};

const renderToolSample: {
  (options?: declarationsTypes.RenderToolOptions): (tool: SampleTool) => string;
  (tool: SampleTool, options?: declarationsTypes.RenderToolOptions): string;
} = dual(isTool, sampleOf);

function renderGlobal(head: string, global: typesModule.CodemodeTool, indent: string): string {
  if (global.signature !== undefined) {
    return `${docComment(global.description, indent)}${indent}${head}${global.signature};`;
  }
  const input = global.inputSchema === undefined ? "unknown" : schemaToType(global.inputSchema);
  const output = global.outputSchema === undefined ? "unknown" : schemaToType(global.outputSchema);
  return `${docComment(global.description, indent)}${indent}${head}(args: ${input}): Promise<${output}>;`;
}

function renderGlobals(globals: readonly typesModule.CodemodeTool[]): string[] {
  const sections: string[] = [];
  const namespaces = new Map<string, string[]>();
  for (const global of globals) {
    const dot = global.name.indexOf(".");
    if (dot === -1) {
      sections.push(renderGlobal(`declare function ${global.name}`, global, ""));
      continue;
    }
    const namespace = global.name.slice(0, dot);
    const members = namespaces.get(namespace) ?? [];
    if (members.length === 0) namespaces.set(namespace, members);
    members.push(renderGlobal(global.name.slice(dot + 1), global, INDENT));
  }
  for (const [namespace, members] of namespaces) {
    sections.push(`declare const ${namespace}: {\n${members.join("\n")}\n};`);
  }
  return sections;
}

function renderDeclarations(options: declarationsTypes.RenderDeclarationsOptions): string {
  const sections: string[] = [];
  const tools = options.tools ?? [];
  if (tools.length > 0) {
    const members = tools.map(
      (tool) => `${docComment(tool.description, INDENT)}${INDENT}${signatureOf(tool)}`,
    );
    sections.push(`declare const tools: {\n${members.join("\n")}\n};`);
  }
  sections.push(...renderGlobals(options.globals ?? []));
  return sections.join("\n\n");
}

const declarations = {
  DEFAULT_INPUT_SCHEMA_MAX_CHARS,
  renderDeclarations,
  renderToolOutputType,
  renderToolSample,
  renderToolSignature,
  schemaToType: schemaType.schemaToType,
  schemaToTypeWithin: schemaType.schemaToTypeWithin,
  toCodemodeIdentifier: bridge.toCodemodeIdentifier,
};

export default declarations;
