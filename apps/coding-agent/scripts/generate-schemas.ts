import { fileURLToPath } from "node:url";

import { Effect, Schema } from "effect";
import type { SchemaError } from "effect/Schema";
import type { TSchema } from "typebox";
import { format } from "vite-plus/fmt";

import scriptOutput from "../../../libs/ai/src/utils/script-output.ts";
import hostModule from "../../../scripts/host.ts";
import schemaArtifactsModule from "./schema-artifacts.ts";
import type schemaArtifactsTypes from "./schema-artifacts.types.ts";

const { Host, runScript } = hostModule;

const { schemaArtifacts } = schemaArtifactsModule;

const packageDirectory = fileURLToPath(new URL("..", import.meta.url));
const schemaBaseUrl =
  "https://raw.githubusercontent.com/masseater/msa/main/apps/coding-agent/schemas";
const schemaDraft = "https://json-schema.org/draft/2020-12/schema";
const generatedComment =
  "This file is generated from TypeScript source. Do not edit it manually; run npm run generate:schemas.";

const DEFINITION_NAME = /^[A-Za-z][A-Za-z0-9_-]*$/u;

const encodeCompactJson = Schema.encodeEffect(Schema.fromJsonString(Schema.Unknown));
const encodeIndentedJson = Schema.encodeEffect(Schema.fromJsonString(Schema.Unknown, { space: 2 }));

class SchemaRenderError extends Schema.TaggedError<
  SchemaRenderError,
  { readonly brand: unique symbol }
>()("SchemaRenderError", { message: Schema.String }) {}

const schemaAnnotationKeys = new Set([
  "default",
  "deprecated",
  "description",
  "examples",
  "readOnly",
  "title",
  "writeOnly",
]);

interface SplitSchema {
  readonly annotations: Record<string, unknown>;
  readonly shape: Record<string, unknown>;
}

const splitAnnotations = (schema: object): SplitSchema => {
  const shape: Record<string, unknown> = {};
  const annotations: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(schema)) {
    (schemaAnnotationKeys.has(key) ? annotations : shape)[key] = value;
  }
  return { annotations, shape };
};

interface PreparedDefinition {
  readonly name: string;
  readonly shape: Record<string, unknown>;
  readonly shapeKey: string;
}

const prepareDefinitions = (
  definitions: Readonly<Record<string, TSchema>>,
): Effect.Effect<ReadonlyArray<PreparedDefinition>, SchemaError | SchemaRenderError> =>
  Effect.forEach(Object.entries(definitions), ([name, definition]) =>
    Effect.gen(function* () {
      if (!DEFINITION_NAME.test(name)) {
        return yield* SchemaRenderError.make({
          message: `Invalid schema definition name: ${name}`,
        });
      }
      const { shape } = splitAnnotations(definition);
      return { name, shape, shapeKey: yield* encodeCompactJson(shape) };
    }),
  );

const makeReplacer = (
  prepared: ReadonlyArray<PreparedDefinition>,
  referenced: Set<string>,
): ((value: unknown, excludedName?: string) => unknown) => {
  const replace = (value: unknown, excludedName?: string): unknown => {
    if (Array.isArray(value)) return value.map((item) => replace(item, excludedName));
    if (typeof value !== "object" || value === null) return value;
    const { shape, annotations } = splitAnnotations(value);
    const shapeKey = JSON.stringify(shape);
    const match = prepared.find(
      (definition) => definition.name !== excludedName && definition.shapeKey === shapeKey,
    );
    if (match !== undefined) {
      referenced.add(match.name);
      return { $ref: `#/$defs/${match.name}`, ...annotations };
    }
    return Object.fromEntries(
      Object.entries(value).map(([key, child]) => [
        key,
        schemaAnnotationKeys.has(key) ? child : replace(child, excludedName),
      ]),
    );
  };
  return replace;
};

const addDefinitions = (
  schema: TSchema,
  definitions: Readonly<Record<string, TSchema>>,
): Effect.Effect<TSchema, SchemaError | SchemaRenderError> =>
  Effect.gen(function* () {
    const prepared = yield* prepareDefinitions(definitions);
    const referenced = new Set<string>();
    const replace = makeReplacer(prepared, referenced);
    const compactSchema = replace(schema) as TSchema;
    const compactDefinitions = Object.fromEntries(
      prepared.map(({ name, shape }) => [name, replace(shape, name)]),
    );
    const unused = prepared.map(({ name }) => name).filter((name) => !referenced.has(name));
    if (unused.length > 0) {
      return yield* SchemaRenderError.make({
        message: `Unused schema definitions: ${unused.join(", ")}`,
      });
    }
    return { ...compactSchema, $defs: compactDefinitions };
  });

const serializeSchema = (artifact: schemaArtifactsTypes.SchemaArtifact) =>
  Effect.gen(function* () {
    const definitions = artifact.definitions;
    const schema =
      definitions === undefined
        ? artifact.schema
        : yield* addDefinitions(artifact.schema, definitions);
    return `${yield* encodeIndentedJson({
      $comment: generatedComment,
      $id: `${schemaBaseUrl}/${artifact.filename}`,
      $schema: schemaDraft,
      ...schema,
    })}\n`;
  });

const renderArtifact = (artifact: schemaArtifactsTypes.SchemaArtifact) =>
  Effect.gen(function* () {
    const relativePath = `schemas/${artifact.filename}`;
    const serialized = yield* serializeSchema(artifact);
    const { code, errors } = yield* Effect.promise(() => format(relativePath, serialized));
    if (errors.length > 0) {
      return yield* SchemaRenderError.make({
        message: `Failed to format ${relativePath}: ${errors.map((error) => error.message).join("; ")}`,
      });
    }
    return [relativePath, code] as const;
  });

const renderConfigSchemas: Effect.Effect<
  ReadonlyMap<string, string>,
  SchemaError | SchemaRenderError
> = Effect.map(Effect.forEach(schemaArtifacts, renderArtifact), (entries) => new Map(entries));

const program = Effect.gen(function* () {
  const host = yield* Host;
  const rendered = yield* renderConfigSchemas;
  yield* Effect.forEach([...rendered], ([relativePath, content]) =>
    Effect.gen(function* () {
      const path = host.resolve(packageDirectory, relativePath);
      yield* host.makeDirectory(host.dirname(path));
      yield* host.writeTextFile(path, content);
      yield* scriptOutput.print(`Generated apps/coding-agent/${relativePath}`);
    }),
  );
});

const invokedPath = process.argv[1];
const invokedFile =
  invokedPath === undefined || invokedPath === ""
    ? undefined
    : fileURLToPath(new URL(invokedPath, `file://${process.cwd()}/`));
if (invokedFile === fileURLToPath(import.meta.url)) {
  runScript(program);
}

const generateSchemas = {
  renderConfigSchemas,
};

export default generateSchemas;
