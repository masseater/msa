# Watch Pull Requests

`pr_watch` watches a GitHub pull request in the background and tells the session when something changes, so a run can wait on CI or a review without polling `gh` itself.

Registering returns at once. The watch reads the pull request with `gh pr view` on an interval, compares the result with the previous read, and sends a message to the session only when something changed. Watches belong to the session: they start when you register them and stop when the session ends.

The tool needs the [GitHub CLI](https://cli.github.com) signed in (`gh auth login`) with access to the repository.

## Enable it

`pr_watch` is registered but off by default. Turn it on for one invocation, or for every session:

```sh
msa --tools +pr_watch
```

```json
{
  "defaultTools": ["+pr_watch"]
}
```

## Actions

| Action  | Arguments                                          | Result                                  |
| ------- | -------------------------------------------------- | --------------------------------------- |
| `watch` | `number`, optional `repository`, `intervalSeconds` | Starts watching and returns immediately |
| `stop`  | `number`, optional `repository`                    | Stops watching that pull request        |
| `list`  | none                                               | Shows each watch with its last state    |

`repository` is `owner/repo`; without it, the watch uses the GitHub repository of the working folder. Registering the same pull request twice keeps one watch, and the second call reports that it is already watching.

```json
{ "action": "watch", "number": 74, "repository": "masseater/msa" }
```

## What it reports

Each change produces one message, written as the next step rather than as a status line:

| Change                         | Message                                                                                 |
| ------------------------------ | --------------------------------------------------------------------------------------- |
| CI finished, all passed        | `#74: CI finished: 3 passed. Merge it once it is approved.`                             |
| CI finished with failures      | `#74: CI finished: 2 passed, 1 failed. Fix the failing checks and push.`                |
| Review approved                | `#74: approved. Merge it when you are ready.`                                           |
| Changes requested              | `#74: has changes requested. Address the review comments and push.`                     |
| New comments                   | `#74: has 2 new comments. Read them before the next push.`                              |
| Merged                         | `#74: merged. The watch stopped; pull the base branch before you continue.`             |
| Closed                         | `#74: closed without merging. The watch stopped; reopen it or open a new pull request.` |
| Conflicts with the base branch | `#74: now conflicts with its base. Rebase onto the base branch and push.`               |

The same state is never reported twice. A merge or a close ends the watch, because nothing is left to follow.

A notification is a session message like any other: it steers a run that is already going, and starts a turn when the session is idle, so an agent that stopped to wait for CI picks the work back up.

## Failures

`gh` failing does not end the watch silently.

- Missing `gh`, no sign-in, or an unknown pull request: the session is told why, and the watch stops.
- A GitHub rate limit or another `gh` error: the session is told once, and the watch keeps going at a longer interval until a read succeeds again.

## Where it shows

The footer carries one line for the watches: each pull request with its latest state, and the last notification.

```
PR masseater/msa#74 1 failed · #75 approved · last #74 CI failed
```

`pr_watch` with `{"action":"list"}` prints the same information with the interval of each watch and its last notification.

## Settings

| Setting                   | Type   | Default | Description                                         |
| ------------------------- | ------ | ------- | --------------------------------------------------- |
| `prWatch.intervalSeconds` | number | `45`    | Seconds between reads of each watched pull request. |

`intervalSeconds` on a `watch` call overrides the setting for that pull request; the shortest accepted interval is 5 seconds.
