import { Data, Effect } from "effect";

import type { ExtensionAPI } from "@msa/coding-agent";
import ms from "ms";
import { Type } from "typebox";

class InvalidDurationError extends Data.TaggedError("InvalidDurationError")<{
  readonly message: string;
}> {}

export default function (msa: ExtensionAPI) {
  msa.registerTool({
    name: "parse_duration",
    label: "Parse Duration",
    description:
      "Parse a human-readable duration string (e.g., '2 days', '1h', '5m') to milliseconds",
    parameters: Type.Object({
      duration: Type.String({ description: "Duration string like '2 days', '1h', '5m'" }),
    }),
    execute: (_toolCallId, params) =>
      Effect.runPromise(
        Effect.gen(function* () {
          const result = ms(params.duration as ms.StringValue);
          if (result === undefined) {
            return yield* new InvalidDurationError({
              message: `Invalid duration: "${params.duration}"`,
            });
          }
          return {
            content: [{ type: "text", text: `${params.duration} = ${result} milliseconds` }],
            details: {},
          };
        }),
      ),
  });
}
