import { Clock, Console, Effect } from "effect";
import { expect } from "vite-plus/test";

import { complete } from "../src/compat.ts";
import type { Api, Model } from "../src/types.ts";
import { isContextOverflow } from "../src/utils/overflow.ts";
import jsonCodec from "./json-codec.ts";

const { encodeJson } = jsonCodec;

const LOREM_IPSUM = `Lorem ipsum dolor sit amet, consectetur adipiscing elit. Sed do eiusmod tempor incididunt ut labore et dolore magna aliqua. Ut enim ad minim veniam, quis nostrud exercitation ullamco laboris nisi ut aliquip ex ea commodo consequat. Duis aute irure dolor in reprehenderit in voluptate velit esse cillum dolore eu fugiat nulla pariatur. Excepteur sint occaecat cupidatat non proident, sunt in culpa qui officia deserunt mollit anim id est laborum. `;

const overflowContent = (contextWindow: number) =>
  LOREM_IPSUM.repeat(Math.ceil(((contextWindow + 10000) * 4 * 1.5) / LOREM_IPSUM.length));

const overflow = Effect.fn("overflow")(function* <TApi extends Api>(
  model: Model<TApi>,
  apiKey: string | undefined,
) {
  const timestamp = yield* Clock.currentTimeMillis;
  const response = yield* Effect.promise(() =>
    complete(
      model,
      {
        messages: [
          {
            content: overflowContent(model.contextWindow),
            role: "user",
            timestamp,
          },
        ],
        systemPrompt: "You are a helpful assistant.",
      },
      { apiKey },
    ),
  );
  yield* Console.log(
    `\n${model.provider} / ${model.id}: stopReason ${response.stopReason}, error ${response.errorMessage}, usage ${yield* encodeJson(response.usage)}`,
  );
  return response;
});

const expectOverflowDetected = <TApi extends Api>(
  model: Model<TApi>,
  apiKey: string | undefined,
  message?: RegExp,
) =>
  Effect.runPromise(
    Effect.gen(function* () {
      const response = yield* overflow(model, apiKey);
      expect(response.stopReason).toBe("error");
      if (message !== undefined) expect(response.errorMessage).toMatch(message);
      expect(isContextOverflow(response, model.contextWindow)).toBe(true);
    }),
  );

const contextOverflowSupport = { expectOverflowDetected, overflow };

export default contextOverflowSupport;
