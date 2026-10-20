import testing from "@msa/testing";
import { Effect } from "effect";

import { renderConfigSchemas } from "../scripts/generate-schemas.ts";

const { runTest } = testing;

const renderedSchemas = new Map<string, string>();

const loadSchemas = () =>
  runTest(
    Effect.map(renderConfigSchemas, (rendered) => {
      for (const [path, content] of rendered) renderedSchemas.set(path, content);
    }),
  );

const configSchemasSupport = {
  loadSchemas,
  renderedSchemas,
};

export default configSchemasSupport;
