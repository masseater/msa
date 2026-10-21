import type codingAgentTypes from "@msa/coding-agent/index.types";
import { Data, Effect } from "effect";
import ms from "ms";
import { Type } from "typebox";

class InvalidDurationError extends Data.TaggedError("InvalidDurationError")<{
  readonly message: string;
}> {}

export default function (msa: codingAgentTypes.ExtensionAPI) {
  msa.registerTool({
    description:
      "Parse a human-readable duration string (e.g., '2 days', '1h', '5m') to milliseconds",
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
            content: [{ text: `${params.duration} = ${result} milliseconds`, type: "text" }],
            details: {},
          };
        }),
      ),
    label: "Parse Duration",
    name: "parse_duration",
    parameters: Type.Object({
      duration: Type.String({ description: "Duration string like '2 days', '1h', '5m'" }),
    }),
  });
}
