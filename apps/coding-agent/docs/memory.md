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

Search combines an embedding similarity score with a keyword score that handles Japanese text as character bigrams, and a memory is recalled when the better of the two reaches `memory.recall.minScore`. Embeddings come from an OpenAI-compatible `/embeddings` endpoint; the default is a local [Ollama](https://ollama.com) endpoint running [EmbeddingGemma 2](https://huggingface.co/google/embeddinggemma-2).

```sh
ollama pull embeddinggemma-2
```

EmbeddingGemma is trained with task prefixes: queries are embedded as `task: search result | query: …` and memories as `title: none | text: …`. msa sends those prefixes by default (`memory.embedding.queryPrefix` and `memory.embedding.documentPrefix`); clear both when you switch to a model that does not use prefixes, such as `bge-m3` (also available in Ollama).

Any endpoint with the OpenAI embeddings shape works, including LM Studio, llama.cpp, and hosted APIs. Without a reachable endpoint, memories are still saved and searched by keyword, and msa retries embedding after a short cooldown.

Similarity ranges differ between models, so `memory.recall.minScore` is tuned for the default model: EmbeddingGemma 2 puts relevant memories around 0.75 or higher, while `bge-m3` tops out lower and wants roughly 0.5.

Changing the embedding model changes the vector width. When a session starts, msa re-embeds up to 25 memories that carry no vector or one from another model in the background; until a memory is re-embedded it keeps working through keyword search.

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
      "model": "embeddinggemma-2",
      "queryPrefix": "task: search result | query: ",
      "documentPrefix": "title: none | text: ",
      "apiKeyEnv": "OPENAI_API_KEY",
      "timeoutMs": 5000
    },
    "recall": {
      "enabled": true,
      "limit": 5,
      "minScore": 0.72
    }
  }
}
```

| Setting                           | Type    | Default                          | Description                                                                    |
| --------------------------------- | ------- | -------------------------------- | ------------------------------------------------------------------------------ |
| `memory.enabled`                  | boolean | `true`                           | Register the `memory` tool, recall, and `/memory`.                             |
| `memory.database`                 | string  | `<agent dir>/memory.db`          | SQLite file holding memories. Relative paths resolve from the agent directory. |
| `memory.embedding.enabled`        | boolean | `true`                           | Compute embeddings for meaning-based search.                                   |
| `memory.embedding.baseUrl`        | string  | `http://127.0.0.1:11434/v1`      | OpenAI-compatible base URL; `/embeddings` is appended.                         |
| `memory.embedding.model`          | string  | `embeddinggemma-2`               | Embedding model at that endpoint.                                              |
| `memory.embedding.queryPrefix`    | string  | EmbeddingGemma's task prefix     | Prepended to search queries; clear it for models without task prefixes.        |
| `memory.embedding.documentPrefix` | string  | EmbeddingGemma's document prefix | Prepended to memory text before embedding.                                     |
| `memory.embedding.apiKeyEnv`      | string  | None                             | Environment variable holding the API key, for endpoints that need one.         |
| `memory.embedding.timeoutMs`      | number  | `5000`                           | Embedding request timeout.                                                     |
| `memory.recall.enabled`           | boolean | `true`                           | Search memory on every user prompt and add matches to the run.                 |
| `memory.recall.limit`             | number  | `5`                              | Maximum memories added to a run.                                               |
| `memory.recall.minScore`          | number  | `0.72`                           | Minimum relevance for a memory to be recalled; tune it with the model.         |

With `memory.enabled: false` the tool is not registered, no recall runs, and `/memory` reports that memory is off.

## Storage

Memories live in one SQLite file (`memory.db`). Each row holds the text, kind (`fact`, `preference`, `decision`, `note`), scope, project, timestamps, use count, and its embedding. Saving the same text twice in the same scope refreshes the existing memory instead of adding a duplicate.

Delete the file to start over. To move memories between machines, copy the file.
