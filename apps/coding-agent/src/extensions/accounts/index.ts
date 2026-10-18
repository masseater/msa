import * as Effect from "effect/Effect";

import { awaited, awaiting } from "../../core/awaiting.ts";
import type { ExtensionAPI } from "../../core/extensions/types.ts";
import { claudeAccounts } from "../cli-agents/claude-account-kind.ts";
import type { AccountKind } from "./kind.ts";

const KINDS: AccountKind[] = [claudeAccounts];

export default function accountsExtension(msa: ExtensionAPI): void {
  msa.registerCommand("accounts", {
    description: `Manage accounts: ${KINDS.map((kind) => kind.name).join(", ")}`,
    getArgumentCompletions: (prefix) => {
      const trimmed = prefix.trimStart();
      const space = trimmed.search(/\s/u);
      if (space < 0) {
        return KINDS.filter((kind) => kind.name.startsWith(trimmed)).map((kind) => ({
          value: `${kind.name} `,
          label: kind.name,
          description: kind.description,
        }));
      }
      const kind = KINDS.find((candidate) => candidate.name === trimmed.slice(0, space));
      return (
        kind
          ?.complete(trimmed.slice(space).trimStart())
          ?.map((item) => ({ ...item, value: `${kind.name} ${item.value}` })) ?? null
      );
    },
    handler: (args, ctx) =>
      Effect.runPromise(
        awaiting(function* () {
          const [name, ...rest] = args.trim().split(/\s+/u).filter(Boolean);
          try {
            if (name === undefined || name === "") {
              const sections = yield* awaited(
                Promise.all(
                  KINDS.map((kind) =>
                    Effect.runPromise(
                      awaiting(function* () {
                        return `${kind.name}:\n${yield* awaited(kind.describe())}`;
                      }),
                    ),
                  ),
                ),
              );
              ctx.ui.notify(sections.join("\n\n"), "info");
              return;
            }
            const kind = KINDS.find((candidate) => candidate.name === name);
            if (kind === undefined) {
              throw new Error(
                `Unknown account kind "${name}". Kinds: ${KINDS.map((k) => k.name).join(", ")}`,
              );
            }
            yield* awaited(kind.run(rest.join(" "), ctx));
          } catch (error) {
            ctx.ui.notify(error instanceof Error ? error.message : String(error), "error");
          }
        }),
      ),
  });
}
