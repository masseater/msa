import type { AssistantMessage } from "@msa/ai";
import type { Op, Path } from "@msa/chord/delta";
import { Function } from "effect";

import type { Block, MessageChange } from "./events-types.ts";
import type { Dual2 } from "./types.ts";

const PARTIAL_PATH = ["docs", "msa.live", "generation", "message"];

export const messageChanges: Dual2<readonly Op[], AssistantMessage, MessageChange[]> =
  Function.dual(2, (viewOps: readonly Op[], message: AssistantMessage): MessageChange[] => {
    const changes: MessageChange[] = [];
    const whole = new Set<number>();
    for (const op of viewOps) {
      const path = op[1] as Path;
      if (!startsWith(path, PARTIAL_PATH)) {
        if (startsWith(PARTIAL_PATH, path)) return [{ type: "message", message }];
        continue;
      }
      const rest = path.slice(PARTIAL_PATH.length);
      if (rest[0] === "usage") continue;
      if (rest[0] !== "content") return [{ type: "message", message }];
      if (rest.length === 1) {
        if (op[0] !== "p" || op[3] !== 0) return [{ type: "message", message }];
        for (const [offset, block] of (op[4] as unknown as Block[]).entries()) {
          const type =
            block.type === "text"
              ? "text_start"
              : block.type === "thinking"
                ? "thinking_start"
                : "toolcall_start";
          changes.push({ type, contentIndex: op[2] + offset, block });
        }
        continue;
      }
      const contentIndex = rest[1] as number;
      const field = rest[2];
      if (whole.has(contentIndex)) continue;
      if (op[0] === "a" && rest.length === 3 && (field === "text" || field === "thinking")) {
        changes.push({
          type: field === "text" ? "text_delta" : "thinking_delta",
          contentIndex,
          delta: op[2],
        });
      } else if (op[0] === "a" && field === "arguments") {
        changes.push({ type: "toolcall_delta", contentIndex, path: rest.slice(3), delta: op[2] });
      } else {
        whole.add(contentIndex);
        changes.push({ type: "block", contentIndex, block: message.content[contentIndex]! });
      }
    }
    return changes;
  });

export const startsWith: Dual2<Path, readonly (string | number)[], boolean> = Function.dual(
  2,
  (path: Path, prefix: readonly (string | number)[]): boolean =>
    prefix.length <= path.length && prefix.every((segment, index) => path[index] === segment),
);
