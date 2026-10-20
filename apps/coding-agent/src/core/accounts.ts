import type tuiTypes from "@msa/tui/index.types";

import { claudeAccounts } from "./cli-agents/claude-account-kind.ts";
import type { ExtensionUIContext } from "./extensions/types.ts";

export interface AccountsContext {
  ui: Pick<ExtensionUIContext, "notify" | "input" | "confirm">;

  refreshProviders(): Promise<void>;
}

export interface AccountKind {
  name: string;
  description: string;

  describe(): Promise<string>;

  run(args: string, ctx: AccountsContext): Promise<void>;

  complete(prefix: string): tuiTypes.AutocompleteItem[] | null;
}

const KINDS: AccountKind[] = [claudeAccounts];

export const ACCOUNTS_DESCRIPTION = `Manage accounts: ${KINDS.map((kind) => kind.name).join(", ")}`;

export function completeAccountsArgument(prefix: string): tuiTypes.AutocompleteItem[] | null {
  const trimmed = prefix.trimStart();
  const space = trimmed.search(/\s/);
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
      ?.map((item) => ({ ...item, value: `${kind.name} ${item.value}` })) ?? null
  );
}

export async function runAccountsCommand(args: string, ctx: AccountsContext): Promise<void> {
  const [name, ...rest] = args.trim().split(/\s+/).filter(Boolean);
  try {
    if (!name) {
      const sections = await Promise.all(
        KINDS.map(async (kind) => `${kind.name}:\n${await kind.describe()}`),
      );
      ctx.ui.notify(sections.join("\n\n"), "info");
      return;
    }
    const kind = KINDS.find((candidate) => candidate.name === name);
    if (!kind) {
      throw new Error(
        `Unknown account kind "${name}". Kinds: ${KINDS.map((k) => k.name).join(", ")}`,
      );
    }
    await kind.run(rest.join(" "), ctx);
  } catch (error) {
    ctx.ui.notify(error instanceof Error ? error.message : String(error), "error");
  }
}
