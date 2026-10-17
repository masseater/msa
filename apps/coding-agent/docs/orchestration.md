# Orchestrate Parallel Sessions

One conversation can only hold so much. The orchestrator lets a session hand pieces of work to separate sessions, each with its own context window, model, and working directory, and collect their reports back into the conversation.

Start msa with [`--orchestrator`](cli.md#tools) to enable it:

```sh
msa --orchestrator
```

The orchestrator keeps the dependencies between sessions in Neo4j, so a database must be reachable through [`NEO4J_URI`, `NEO4J_USERNAME`, and `NEO4J_PASSWORD`](environment-variables.md#orchestrator).

## How the work is shaped

The conversation you talk to is the orchestrator. It answers simple questions itself and sends new work to sessions, one per independent task. A session sees nothing of the orchestrator's conversation except the prompt it was given, so the prompt carries the whole task.

Each session declares the sessions it depends on. A session starts once those have completed, and their reports are appended to its prompt. Independent sessions run in parallel, up to [`orchestrator.maxConcurrentSessions`](settings.md#orchestrator).

Sessions started together form a round, and every round ends in one review session. The review depends on the sessions nothing else depends on, so it runs after the whole round, and it runs alone. It judges the results against each other and against the original intent, then lays out the remaining work as the next round's sessions. Work started after a round has been reviewed joins the next round.

When a session finishes, its report arrives in the orchestrator conversation as a card; expand it for the full report. A failed session reports its error, and the sessions waiting on it stay queued until it is rerun or stopped.

## Watch and steer sessions

`/sessions` opens the view where you, rather than the model, drive the work.

The list groups tasks by status — failed, running, waiting, done, stopped — and puts the reviews last. Each row shows what the session is waiting for, what it is doing right now, or the first line of its report. A running session shows how long it has been running and whether it is waiting for the model or retrying, which is how you tell a slow model from a stuck session.

| Key       | In the list      | In a session                        |
| --------- | ---------------- | ----------------------------------- |
| `↑` / `↓` | Select           |                                     |
| `Enter`   | Open             | Steer it while it runs, or rerun it |
| `s`       | Stop             | Stop                                |
| `m`       | Switch its model | Switch its model                    |
| `Esc`     | Close            | Back to the list                    |

A session's detail shows its dependencies, its recent activity, its report or error, and its task. Steering a running session sends your message into its conversation; sending to a finished, failed, or stopped session reruns it with your message, keeping its transcript.

Switching the model of a running session takes effect on its next request, which is the way to move a session off a model that is not answering.

Keys are [configurable](keybindings.md) as `app.orchestrator.stop` and `app.orchestrator.model`.

## Choose models per session

A session inherits the orchestrator's model unless `start_session` names one, or [`orchestrator.workerModel`](settings.md#orchestrator) and `orchestrator.reviewModel` set defaults for tasks and reviews. Reviews justify a stronger model than tasks: the review is where the approach is corrected, while tasks carry out work that is already decided.

Sessions inherit the orchestrator's settings, project trust, tool selection, and extensions, so they can do what the orchestrator can do.

## Read what a session did

Each session writes its own transcript under `workers/` in the conversation's session folder. The path is shown by `read_session`, and the file is an ordinary [session file](session-format.md) you can resume or inspect.

## Tools

These are the tools `--orchestrator` adds. You rarely call them yourself — the orchestrator does — but they are what it has.

| Tool                | Purpose                                                                |
| ------------------- | ---------------------------------------------------------------------- |
| `start_session`     | Start a session for one task, declaring the sessions it depends on     |
| `list_sessions`     | List this conversation's sessions with status, model, and dependencies |
| `read_session`      | Read a session's full report, prompt, and transcript path              |
| `send_to_session`   | Steer a running session, or rerun a finished one                       |
| `set_session_model` | Switch a session's model and thinking level, including while it runs   |
| `stop_session`      | Stop a running or queued session                                       |
