# Search Past Sessions

`search_sessions` finds words in the conversations and work of past sessions: what the user asked for and decided, what the assistant answered, which tools it called with which arguments, and what those tools returned. It searches ordinary sessions and every orchestrator thread alike, so the orchestrator, its workers and reviewers, and an ordinary session can all look up how earlier work went.

`search_sessions` is one of the default tools, and it is read-only, so it also stays in an [`/ask`](slash-commands.md#ask-a-question) turn. To drop it, name the tools you want in `defaultTools`, or remove it with `--tools -search_sessions`.

## What it searches

Every session file under `<agent dir>/sessions` (and under `sessionDir` when that setting points elsewhere), worker and reviewer threads included, is split into parts, and each part is searched on its own:

| Kind          | Text                                                                  |
| ------------- | --------------------------------------------------------------------- |
| `user`        | A user message, including the prompts the orchestrator gives a thread |
| `assistant`   | The text of an assistant message                                      |
| `tool_call`   | The arguments of one tool call, each as `name: value`                 |
| `tool_result` | The whole text a tool returned, however long                          |

Thinking, system prompts, and the notices msa adds to a conversation (such as `pr_watch` messages and orchestrator reports, which [`search_reports`](cli.md#tools) searches) are not searched. Calls to `search_sessions` itself and their results are left out, so a search does not find earlier searches.

## Words

All words of the query must appear in the same part. Latin words match whole words, ignoring case and full-width forms; Japanese, Chinese, and Korean text matches as written, anywhere inside longer text, so `継承` finds `継承関係` and `既知の限界` finds that phrase. Quote words that must stay together and in order: `"git push"` finds `git push origin` but not `git stash push`.

## Filters

Each filter takes a list, and a result must match every filter given:

| Filter           | Keeps                                                                                                                           |
| ---------------- | ------------------------------------------------------------------------------------------------------------------------------- |
| `kinds`          | Parts of these kinds                                                                                                            |
| `tools`          | Calls to and results of these tools, such as `bash` or `edit`                                                                   |
| `roles`          | Sessions run as `orchestrator`, `worker`, `reviewer`, `triage`, `advisor`, or `session` (an ordinary session)                   |
| `taskIds`        | Threads assigned to these tasks                                                                                                 |
| `threadIds`      | These orchestrator threads                                                                                                      |
| `rounds`         | Threads of tasks in these rounds                                                                                                |
| `cwd`            | Sessions whose working directory starts with this text, so a repository path also keeps the task worktrees next to it           |
| `since`, `until` | Parts written from the start of `since` to the end of `until`; a date (`2026-10-27`) is a whole local day, a date-time is exact |

A thread's role, task, and round come from `orchestrator.db`; a session that called an orchestrator tool is an `orchestrator` session. `order` sorts by `relevance` (the default), `newest`, or `oldest`, and `limit` caps the results (20 by default, at most 100).

```json
{ "query": "\"git push\"", "kinds": ["tool_call"], "tools": ["bash"], "roles": ["worker"] }
```

## Results and reading on

Each result names when it was written, its kind and tool, the session's role with its task, round, and thread, the session file and the entry, the session's working directory and start time, and a passage around the first match. Under the results, `Not searched` lists the session files the index had to leave out, each with the reason, so a search that finds nothing in them says so. To keep reading from there, call `search_sessions` with `action: "read"`, the `session` file, and the `entry`; `before` and `after` choose how many entries around it to show (0 and 10 by default). A read returns up to 50,000 characters and, when there is more, ends with the entry and `from` offset to continue with.

```json
{ "action": "read", "session": "<session file>", "entry": "75be970c", "after": 20 }
```

In interactive mode, `/search [words]` opens the same search: type words and press `enter`, move with `↑` and `↓`, press `enter` to read from a result, `n` for the next page, `/` for a new search, and `escape` to go back or close.

## The index

The session files stay the record; the index only points into them. It lives in `<agent dir>/session-index/v<format>/`, where each msa reads and writes only the directory of its own index format, so going back to an earlier msa, or forward again, finds its own index as it left it and never has to refuse or delete another one. Each search first brings the index up to date: it reads only what was appended to each session file since the last search, reads a file again from the start when it was rewritten or shrank, and drops files that are gone from the session directories it searches, leaving those of directories other sessions search. A line still being written is indexed once it ends. The first search builds the index from every session file, which takes a while on a large history; later searches only read what changed.

The index is a file in that directory that `current` names. A rebuild writes a new file next to it and switches `current` to it once it is complete, then deletes the earlier files; one process builds at a time, and a process that is gone leaves its build to the next search. Searches in other processes keep answering from the file they have open, appends included, without waiting for the rebuild, and move to the new file on their next search. A search rebuilds the index when it cannot open it, when it records another format, when an update or a read fails, or when another connection keeps it locked for 10 seconds; until then it waits without holding up the rest of msa. Deleting the `session-index` directory rebuilds it on the next search, and the directory of a format that no msa you run uses anymore can be deleted. A session file that cannot be read into parts, such as one nested too deeply, is skipped with the reason recorded in the index, and the other sessions stay searchable; it is read again once its size or modification time changes, and until then each search lists it under `Not searched`. A search that can neither open nor rebuild the index fails with the `session-index` directory and the reason.
