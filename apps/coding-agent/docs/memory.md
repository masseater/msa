# Long-Term Memory

msa keeps long-term memories across sessions in a local SQLite database, and the `memory` tool lets the model save, search, list, and forget them.

Memory is separate from context files and compaction: those keep one conversation coherent, while memory survives sessions and working folders.

## What the model sees

- Every user prompt first searches memory and adds a `<memory>` block with the best matches to that run. The block is stored with the session (hidden from the transcript view), so later turns keep the recalled context without searching again.
- The `memory` tool is active by default next to `read`, `bash`, `edit`, and `write`.
- When memories were used, their use count rises so they rank higher later.

## Scopes

Each memory is either `project` or `global`.

- `project` memories belong to the git repository of the working folder, or to the folder name outside a repository, and are only recalled there.
- `global` memories are recalled everywhere. Use them for user preferences.

## Embeddings

Search combines an embedding similarity score with a keyword score that handles Japanese text as character bigrams. Embeddings come from an OpenAI-compatible `/embeddings` endpoint; the default is a local [Ollama](https://ollama.com) endpoint.

```sh
ollama pull bge-m3
```

Any endpoint with the OpenAI embeddings shape works, including LM Studio, llama.cpp, and hosted APIs. Without a reachable endpoint, memories are still saved and searched by keyword, and msa retries embedding after a short cooldown.

Changing the embedding model changes the vector width; memories saved with another model keep working through keyword search but no longer match on meaning.

## Manage memories

Type `/memory` in the interactive TUI to open the memory view: every memory grouped by scope, one memory in detail, and keys to browse, search, add, and forget without leaving the screen.

| Key     | Action                                                   |
| ------- | -------------------------------------------------------- |
| `↑` `↓` | Select a memory                                          |
| `enter` | Open the selected memory with its full text and metadata |
| `/`     | Search memories by meaning and keywords                  |
| `a`     | Add a memory by hand (kind `fact`, scope `project`)      |
| `d`     | Forget the selected memory, after a confirmation         |
| `esc`   | Back from a memory or a search, or close the view        |

The same store works from the command line:

| Command                  | Description                              |
| ------------------------ | ---------------------------------------- |
| `/memory list`           | List the newest memories of this project |
| `/memory search <query>` | Search memories by meaning and keywords  |
| `/memory forget <id>`    | Delete one memory                        |
| `/memory stats`          | Show counts by kind and project          |

The model manages the same store through the `memory` tool, with `save`, `search`, `list`, and `forget` actions.

## Settings

```json
{
  "memory": {
    "enabled": true,
    "database": "~/.msa/agent/memory.db",
    "embedding": {
      "enabled": true,
      "baseUrl": "http://127.0.0.1:11434/v1",
      "model": "bge-m3",
      "apiKeyEnv": "OPENAI_API_KEY",
      "timeoutMs": 5000
    },
    "recall": {
      "enabled": true,
      "limit": 5,
      "minScore": 0.35
    }
  }
}
```

| Setting                      | Type    | Default                     | Description                                                                    |
| ---------------------------- | ------- | --------------------------- | ------------------------------------------------------------------------------ |
| `memory.enabled`             | boolean | `true`                      | Register the `memory` tool, recall, and `/memory`.                             |
| `memory.database`            | string  | `<agent dir>/memory.db`     | SQLite file holding memories. Relative paths resolve from the agent directory. |
| `memory.embedding.enabled`   | boolean | `true`                      | Compute embeddings for meaning-based search.                                   |
| `memory.embedding.baseUrl`   | string  | `http://127.0.0.1:11434/v1` | OpenAI-compatible base URL; `/embeddings` is appended.                         |
| `memory.embedding.model`     | string  | `bge-m3`                    | Embedding model at that endpoint.                                              |
| `memory.embedding.apiKeyEnv` | string  | None                        | Environment variable holding the API key, for endpoints that need one.         |
| `memory.embedding.timeoutMs` | number  | `5000`                      | Embedding request timeout.                                                     |
| `memory.recall.enabled`      | boolean | `true`                      | Search memory on every user prompt and add matches to the run.                 |
| `memory.recall.limit`        | number  | `5`                         | Maximum memories added to a run.                                               |
| `memory.recall.minScore`     | number  | `0.35`                      | Minimum hybrid score for a memory to be recalled.                              |

With `memory.enabled: false` the tool is not registered, no recall runs, and `/memory` reports that memory is off.

## Storage

Memories live in one SQLite file (`memory.db`). Each row holds the text, kind (`fact`, `preference`, `decision`, `note`), scope, project, timestamps, use count, and its embedding. Saving the same text twice in the same scope refreshes the existing memory instead of adding a duplicate.

Delete the file to start over. To move memories between machines, copy the file.
