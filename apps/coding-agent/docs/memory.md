# Long-Term Memory

msa keeps long-term memory in [sepiace](https://sepiace.io), a remote MCP server. The model passes sepiace one natural-language request, and sepiace decides whether to remember, recall, or forget. Memories are cut from the words in the request and come back as text only, with no IDs, dates, or scores.

Memory is separate from context files and compaction: those keep one conversation coherent, while memory survives sessions, working folders, and other agents that use the same sepiace account.

## Sign in

sepiace is a built-in MCP server named `sepiace` (`https://hi.sepiace.io/api/v1/mcp`). Sign in once with `/mcp login sepiace` in a session or `msa mcp login sepiace` from a shell; until then the `memory` tool reports that sign-in is needed and prompts run without recall. After `/mcp logout sepiace` or turning the server off in `/mcp`, the `memory` tool is gone, `/memory` shows sepiace as not connected, and `memory.db` is not moved. Sign-ins are kept as described in [Store sign-ins](mcp.md#store-sign-ins).

## What the model sees

- The `memory` tool takes one `request`, such as "Remember that the user prefers pnpm over npm.", "What did the user decide about the release schedule?", or "Forget the user's old home address." It is active by default next to `read`, `bash`, `edit`, and `write`.
- Every user prompt first asks sepiace a question: what it remembers that is relevant to the prompt in the current repository. The prompt goes in as a quotation inside that question, which tells sepiace not to remember or forget anything, so a prompt such as "forget my old address" only recalls. What comes back is added to that run as a `<memory>` block, stored with the session and hidden from the transcript view. Recall waits up to 5 seconds; when sepiace is not signed in, unreachable, or recalls nothing, the prompt runs without the block.

## Scope

sepiace keeps memories per account, not per project. Recall names the current repository (the git repository of the working folder, or the folder name outside one), and the model names the repository in a fact that only applies there.

## Secrets

msa checks each request with the recommended rules of [secretlint](https://github.com/secretlint/secretlint), which find API keys, access tokens, private keys, and URLs with passwords. A request that matches is not sent: the `memory` tool and `/memory` fail with the names of the rules, and recall skips that prompt.

## Offline

Nothing is queued for later. A `memory` tool call or `/memory` request that cannot reach sepiace fails with the error, and recall gives up so the prompt still runs.

## Manage memories

Type `/memory` in the interactive TUI to open the memory view: the sepiace connection, whether the sign-in is saved, whether recall runs, and whether `memory.db` is waiting to move, with keys to send sepiace a request and read its reply.

| Key     | Action                                                            |
| ------- | ----------------------------------------------------------------- |
| `enter` | Type a request, such as "forget my old home address", and send it |
| `↑` `↓` | Scroll a reply longer than the view                               |
| `r`     | Turn recall on every prompt on or off (`memory.recall.enabled`)   |
| `esc`   | Cancel the request being typed, or close the view                 |

`/memory <request>` sends a request without the view and prints the reply; outside the TUI, `/memory` prints the same status as the view.

Because sepiace returns no IDs, msa cannot list memories or delete one by ID. The sepiace console at [hi.sepiace.io/requests](https://hi.sepiace.io/requests) lists every request with the memories it changed.

## Move memories from memory.db

msa 0.0.5 and earlier kept memories in `<agent dir>/memory.db`, or in the file `memory.database` named. When a session finds that file and sepiace is signed in, msa sends its memories to sepiace once, several per request and each request under 4,000 characters, naming the project for memories that belonged to one and splitting a longer memory at sentence ends. It then renames the file to `memory.db.migrated` and stops reading it. Memories that look like secrets are not sent; a notice lists them. If a request fails, the next session sends the memories that were not sent yet.

## Settings

```json
{
  "memory": {
    "enabled": true,
    "recall": { "enabled": true }
  }
}
```

| Setting                 | Type    | Default | Description                                                                          |
| ----------------------- | ------- | ------- | ------------------------------------------------------------------------------------ |
| `memory.enabled`        | boolean | `true`  | Turn on the built-in `sepiace` MCP server, the `memory` tool, recall, and `/memory`. |
| `memory.recall.enabled` | boolean | `true`  | Ask sepiace about every user prompt and add what it recalls to the run.              |

Settings files that still hold `memory.embedding.*`, `memory.recall.limit`, or `memory.recall.minScore` get a startup warning for each key. `memory.database` gets one saying it is read only to move `memory.db` to sepiace.

With `memory.enabled: false` the `sepiace` server is turned off, the `memory` tool and `/memory` are not offered, and no recall runs. An entry named `sepiace` in `mcp.json` changes the built-in server: `{ "enabled": false }` turns it off, and a `url` in the user-level file points it elsewhere. msa reaches sepiace through the built-in MCP support: with `--no-mcp`, or an extension that replaces that support, the `memory` tool reports that sepiace is not connected and no recall runs.
