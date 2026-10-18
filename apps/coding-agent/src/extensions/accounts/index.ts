import type { AutocompleteItem } from "@msa/tui";
import * as Effect from "effect/Effect";

import { awaited, awaiting } from "../../core/awaiting.ts";
import type { ExtensionAPI, ExtensionCommandContext } from "../../core/extensions/types.ts";
import { claudeAccounts } from "../cli-agents/claude-account-kind.ts";
import type { AccountKind } from "./kind.ts";

const KINDS: AccountKind[] = [claudeAccounts];

function completeAccountKind(prefix: string): AutocompleteItem[] | null {
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
      ?.map((item) => Object.assign({}, item, { value: `${kind.name} ${item.value}` })) ?? null
  );
}

function* describeKinds(): Generator<Effect.Effect<unknown>, string, unknown> {
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
  return sections.join("\n\n");
}

function* runAccountsCommand(
  args: string,
  ctx: ExtensionCommandContext,
): Generator<Effect.Effect<unknown>, void, unknown> {
  const [name, ...rest] = args.trim().split(/\s+/u).filter(Boolean);
  try {
    if (name === undefined || name === "") {
      ctx.ui.notify(yield* describeKinds(), "info");
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
}

export default function accountsExtension(msa: ExtensionAPI): void {
  msa.registerCommand("accounts", {
    description: `Manage accounts: ${KINDS.map((kind) => kind.name).join(", ")}`,
    getArgumentCompletions: completeAccountKind,
    handler: (args, ctx) =>
      Effect.runPromise(
        awaiting(function* () {
          yield* runAccountsCommand(args, ctx);
        }),
      ),
  });
}
