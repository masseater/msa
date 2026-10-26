import type tuiTypes from "@msa/tui/index.types";
import { Effect } from "effect";

import type accountsTypes from "./accounts.types.ts";
import awaitingModule from "./awaiting.ts";
import claudeAccountKind from "./cli-agents/claude-account-kind.ts";

const { awaited, awaiting } = awaitingModule;

const { claudeAccounts } = claudeAccountKind;

const KINDS: accountsTypes.AccountKind[] = [claudeAccounts];

const ACCOUNTS_DESCRIPTION = `Manage accounts: ${KINDS.map((kind) => kind.name).join(", ")}`;

function completeAccountsArgument(prefix: string): tuiTypes.AutocompleteItem[] | null {
  const trimmed = prefix.trimStart();
  const space = trimmed.search(/\s/u);
  if (space < 0) {
    return KINDS.filter((kind) => kind.name.startsWith(trimmed)).map((kind) => ({
      description: kind.description,
      label: kind.name,
      value: `${kind.name} `,
    }));
  }
  const kind = KINDS.find((candidate) => candidate.name === trimmed.slice(0, space));
  return (
    kind
      ?.complete(trimmed.slice(space).trimStart())
      ?.map((item) => Object.assign(item, { value: `${kind.name} ${item.value}` })) ?? null
  );
}

function runAccountsCommand(args: string, ctx: accountsTypes.AccountsContext): Promise<void> {
  return Effect.runPromise(
    awaiting(function* () {
      const [name, ...rest] = args.trim().split(/\s+/u).filter(Boolean);
      try {
        if (name === undefined || name === "") {
          const sections = yield* awaited(
            Promise.all(
              KINDS.map((kind) =>
                Effect.runPromise(
                  awaiting(function* () {
                    return yield* awaited(`${kind.name}:\n${yield* awaited(kind.describe())}`);
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
  );
}

const accounts = {
  ACCOUNTS_DESCRIPTION,
  completeAccountsArgument,
  runAccountsCommand,
};

export default accounts;
