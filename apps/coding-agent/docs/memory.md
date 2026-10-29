# Long-Term Memory

msa keeps long-term memory in [sepiace](https://sepiace.io), a remote MCP server. The model passes sepiace one natural-language request, and sepiace decides whether to remember, recall, or forget. Memories are cut from the words in the request and come back as text only, with no IDs, dates, or scores.

Memory is separate from context files and compaction: those keep one conversation coherent, while memory survives sessions, working folders, and other agents that use the same sepiace account.

## Sign in

Memory connects to sepiace (`https://hi.sepiace.io/api/v1/mcp`) itself. It is not an MCP server: it is not listed or switched in `/mcp`, `mcp.json` does not configure it, and `--no-mcp` or an extension that replaces the MCP support leaves memory working.

Sign in once with `s` in the `/memory` view or `msa memory login` from a shell. A sign-in saved by `msa mcp login sepiace` or `/mcp login sepiace` in msa 0.0.7 and earlier keeps working. Until you sign in, the `memory` tool reports that sign-in is needed, prompts run without recall, and `memory.db` is not moved. When the saved sign-in cannot be read, for example because the credential helper fails while the keychain is locked, `msa memory status`, `/memory`, and the `memory` tool show the store's error instead. msa asks the store again on the next status check, prompt, or `memory` call, so memory connects once the keychain unlocks without restarting msa. Sign out with `o` in the `/memory` view or `msa memory logout`. Sign-ins are stored where MCP sign-ins are, as described in [Store sign-ins](mcp.md#store-sign-ins).

| Command             | Action                                                      |
| ------------------- | ----------------------------------------------------------- |
| `msa memory status` | Show whether memory is on, signed in, and connected         |
| `msa memory login`  | Sign in in the browser; `--timeout <seconds>` (default 300) |
| `msa memory logout` | Remove the stored sign-in                                   |

## What the model sees

- The `memory` tool takes one `request`, such as "Remember that the user prefers pnpm over npm.", "What did the user decide about the release schedule?", or "Forget the user's old home address." It is active by default next to `read`, `bash`, `edit`, and `write`.
- Every user prompt first asks sepiace a question: what it remembers that is relevant to the prompt in the current repository. The prompt goes in only as a quotation inside that question, which asks sepiace not to remember or forget anything. sepiace's public docs give no read-only way to ask, and its [skill](https://github.com/osaxyz/sepiace/blob/main/skills/memory/SKILL.md) says the server "combines them when a request asks for more than one", so whether a prompt such as "forget my old address" only recalls is up to sepiace. What comes back is added to that run as a `<memory>` block, stored with the session and hidden from the transcript view. Recall waits up to 5 seconds; when sepiace is not signed in, rejects the saved sign-in, cannot be reached, or recalls nothing, the prompt runs without the block.
- In `msa -p` and `--mode json`, when memory is on and a prompt's recall is skipped because the sign-in is missing or rejected, the saved sign-in cannot be read, sepiace cannot be reached or fails, or sepiace does not answer within the 5 seconds, one line goes to stderr, such as `Memory recall skipped: not signed in; sign in with /memory or msa memory login`. stdout and the exit code do not change, and nothing is written when `memory.enabled` or `memory.recall.enabled` is off or sepiace recalls nothing.

## Scope

sepiace keeps memories per account, not per project. Recall names the current repository (the git repository of the working folder, or the folder name outside one), and the model names the repository in a fact that only applies there.

## Secrets

msa checks each request with the recommended rules of [secretlint](https://github.com/secretlint/secretlint), which find API keys, access tokens, private keys, and URLs with passwords. A request that matches is not sent: the `memory` tool and `/memory` fail with the names of the rules, and recall skips that prompt.

## Offline

Nothing is queued for later. A `memory` tool call or `/memory` request that cannot reach sepiace fails with the error, and recall gives up so the prompt still runs.

## Manage memories

Type `/memory` in the interactive TUI to open the memory view: the sepiace connection, whether the sign-in is saved, whether recall runs, and whether `memory.db` is waiting to move, with keys to sign in or out and to send sepiace a request and read its reply.

| Key     | Action                                                                                                        |
| ------- | ------------------------------------------------------------------------------------------------------------- |
| `enter` | Type a request, such as "forget my old home address", and send it                                             |
| `↑` `↓` | Scroll a reply longer than the view                                                                           |
| `r`     | Turn recall on every prompt on or off (`memory.recall.enabled`)                                               |
| `s`     | Sign in to sepiace in the browser; `enter` takes the URL the browser was redirected to if it cannot reach msa |
| `o`     | Sign out of sepiace                                                                                           |
| `esc`   | Cancel the request being typed or the sign-in, or close the view                                              |

`/memory <request>` sends a request without the view and prints the reply; outside the TUI, `/memory` prints the same status as the view, and `msa memory status` prints it from a shell.

Because sepiace returns no IDs, msa cannot list memories or delete one by ID. The sepiace console at [hi.sepiace.io/requests](https://hi.sepiace.io/requests) lists every request with the memories it changed.

## Move memories from memory.db

msa 0.0.5 and earlier kept memories in `<agent dir>/memory.db`, or in the file `memory.database` named. When a session finds that file and memory is signed in to sepiace, msa sends its memories to sepiace once, several per request and each request under 4,000 characters, naming the project for memories that belonged to one and splitting a longer memory at sentence ends. It then renames the file to `memory.db.migrated` and stops reading it. Memories that look like secrets are not sent; a notice lists them. If a request fails, the next session sends the memories that were not sent yet.

## Settings

```json
{
  "memory": {
    "enabled": true,
    "recall": { "enabled": true }
  }
}
```

| Setting                 | Type    | Default                            | Description                                                                                     |
| ----------------------- | ------- | ---------------------------------- | ----------------------------------------------------------------------------------------------- |
| `memory.enabled`        | boolean | `true`                             | Turn on the connection to sepiace, the `memory` tool, recall, and `/memory`.                    |
| `memory.recall.enabled` | boolean | `true`                             | Ask sepiace about every user prompt and add what it recalls to the run.                         |
| `memory.url`            | string  | `https://hi.sepiace.io/api/v1/mcp` | The sepiace endpoint. Read only from the global `settings.json`; a project file gets a warning. |

Settings files that still hold `memory.embedding.*`, `memory.recall.limit`, or `memory.recall.minScore` get a startup warning for each key. `memory.database` gets one saying it is read only to move `memory.db` to sepiace.

`memory.enabled` alone turns memory on and off. With `memory.enabled: false` msa does not connect to sepiace, the `memory` tool and `/memory` are not offered, and no recall runs.

`mcp.json` does not configure memory. An `mcpServers` entry named `sepiace`, or one whose `url` is on `hi.sepiace.io`, is ignored, gets a warning at startup, and is refused by `msa mcp add`; set `memory.enabled` and `memory.url` instead. `msa.registerMcpServer()` ignores such a server from an extension too, with the same warning naming the extension's file. The model sees only the `memory` tool, never sepiace's own tool.
