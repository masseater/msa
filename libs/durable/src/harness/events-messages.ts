import type { AssistantMessage } from "@msa/ai";
import type { Op, Path } from "@msa/chord/delta";
import { Function } from "effect";

import type eventsTypesModule from "./events-types.ts";
import type typesModule from "./types.types.ts";

const PARTIAL_PATH = ["docs", "msa.live", "generation", "message"];

const messageChanges: typesModule.Dual2<
  readonly Op[],
  AssistantMessage,
  eventsTypesModule.MessageChange[]
> = Function.dual(
  2,
  (viewOps: readonly Op[], message: AssistantMessage): eventsTypesModule.MessageChange[] => {
    const changes: eventsTypesModule.MessageChange[] = [];
    const whole = new Set<number>();
    for (const op of viewOps) {
      const path = op[1] as Path;
      if (!startsWith(path, PARTIAL_PATH)) {
        if (startsWith(PARTIAL_PATH, path)) return [{ message, type: "message" }];
        continue;
      }
      const rest = path.slice(PARTIAL_PATH.length);
      if (rest[0] === "usage") continue;
      if (rest[0] !== "content") return [{ message, type: "message" }];
      if (rest.length === 1) {
        if (op[0] !== "p" || op[3] !== 0) return [{ message, type: "message" }];
        for (const [offset, block] of (op[4] as unknown as eventsTypesModule.Block[]).entries()) {
          const type =
            block.type === "text"
              ? "text_start"
              : block.type === "thinking"
                ? "thinking_start"
                : "toolcall_start";
          changes.push({ block, contentIndex: op[2] + offset, type });
        }
        continue;
      }
      const contentIndex = rest[1] as number;
      const field = rest[2];
      if (whole.has(contentIndex)) continue;
      if (op[0] === "a" && rest.length === 3 && (field === "text" || field === "thinking")) {
        changes.push({
          contentIndex,
          delta: op[2],
          type: field === "text" ? "text_delta" : "thinking_delta",
        });
      } else if (op[0] === "a" && field === "arguments") {
        changes.push({ contentIndex, delta: op[2], path: rest.slice(3), type: "toolcall_delta" });
      } else {
        whole.add(contentIndex);
        changes.push({ block: message.content[contentIndex]!, contentIndex, type: "block" });
      }
    }
    return changes;
  },
);

const startsWith: typesModule.Dual2<Path, readonly (string | number)[], boolean> = Function.dual(
  2,
  (path: Path, prefix: readonly (string | number)[]): boolean =>
    prefix.length <= path.length && prefix.every((segment, index) => path[index] === segment),
);

const eventsMessages = {
  messageChanges,
  startsWith,
};

export default eventsMessages;
