# Telemetry

msa sends OpenTelemetry traces, metrics, and logs from every run without any setup. They answer the questions a look back needs: which task used which model, how long and how much it took, where it stalled, and which tools failed.

## Where the data goes

msa picks one destination at startup:

1. `MSA_OTLP_ENDPOINT`, an OTLP/HTTP base URL such as `http://collector:4318`.
2. The `telemetry.otlpEndpoint` setting.
3. Otherwise a local [grafana/otel-lgtm](https://github.com/grafana/docker-otel-lgtm) container that msa runs with **podman**.
4. Without podman, nothing is sent.

The startup output has one line naming the destination, and `/status` repeats it under **Telemetry**:

```text
Telemetry: Grafana http://localhost:3000 (podman msa-grafana-lgtm)
Telemetry off: podman not found; install podman or set MSA_OTLP_ENDPOINT to send traces, metrics, and logs
```

Signals go to `<endpoint>/v1/traces`, `/v1/metrics`, and `/v1/logs` as OTLP/JSON. They are sent in batches and flushed when msa exits.

### The podman container

msa only uses podman. Install it once; on macOS, also create its machine:

```sh
brew install podman
podman machine init
```

At startup msa looks for a container named `msa-grafana-lgtm`. It reuses a running one, starts a stopped one, and creates a missing one from `docker.io/grafana/otel-lgtm:latest`. When `podman ps` fails because the podman machine is down, msa runs `podman machine start` first. The work runs in the background, so startup does not wait for it, and telemetry begins once the collector answers; the first creation also pulls the image.

The container publishes these ports on `127.0.0.1`:

| Port | Service              |
| ---- | -------------------- |
| 3000 | Grafana              |
| 4318 | OTLP/HTTP receiver   |
| 3200 | Tempo (traces)       |
| 9090 | Prometheus (metrics) |
| 3100 | Loki (logs)          |

Data lives in the podman volume `msa-grafana-lgtm`, so it survives container restarts. To start over, remove the container and the volume:

```sh
podman rm --force msa-grafana-lgtm && podman volume rm msa-grafana-lgtm
```

## Traces

Orchestrated work forms one trace per task:

```text
msa.task                 a task, from its first thread until it completes, fails, or stops
└─ msa.thread            one worker or reviewer thread on that task
   └─ msa.turn           one assistant response and the tools it called
      ├─ msa.llm.request one model call
      └─ msa.tool.call   one tool call
```

Turns of the session you talk to are traces of their own, rooted at `msa.turn`. `msa.compaction` spans cover context compaction.

| Span              | Attributes                                                                                                                                                                                                                                                               |
| ----------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `msa.task`        | `msa.task.id`, `msa.task.kind`, `msa.task.title`, `msa.task.round`, `msa.task.status`                                                                                                                                                                                    |
| `msa.thread`      | `msa.thread.id`, `msa.thread.role` (`worker`, `reviewer`), `msa.task.id`, `gen_ai.request.model`, `msa.thinking_level`, `msa.thread.status`                                                                                                                              |
| `msa.turn`        | `msa.session.role` (`main`, `worker`, `reviewer`), `msa.turn.index`, `gen_ai.provider.name`, `gen_ai.request.model`, `msa.thinking_level`                                                                                                                                |
| `msa.llm.request` | `gen_ai.provider.name`, `gen_ai.request.model`, `gen_ai.response.model`, `msa.thinking_level`, `msa.stop_reason`, `gen_ai.usage.input_tokens`, `gen_ai.usage.output_tokens`, `msa.usage.cache_read_tokens`, `msa.usage.cache_write_tokens`, `msa.cost.usd`, `error.type` |
| `msa.tool.call`   | `gen_ai.tool.name`, `gen_ai.tool.call.id`, `error.type`                                                                                                                                                                                                                  |

A failed, stopped, or aborted span has error status with the reason as its message. Spans still open when msa exits end with `msa.unfinished=true`.

## Metrics

Prometheus names, as the container stores them:

| Metric                             | Labels                                                                               | Meaning                                                            |
| ---------------------------------- | ------------------------------------------------------------------------------------ | ------------------------------------------------------------------ |
| `msa_llm_tokens_total`             | `gen_ai_provider_name`, `gen_ai_request_model`, `msa_session_role`, `msa_token_type` | Tokens by `input`, `output`, `cache_read`, `cache_write`           |
| `msa_llm_cost_USD_total`           | `gen_ai_provider_name`, `gen_ai_request_model`, `msa_session_role`                   | Cost in US dollars                                                 |
| `msa_llm_request_duration_seconds` | `gen_ai_provider_name`, `gen_ai_request_model`, `msa_session_role`, `msa_outcome`    | Histogram of model call time                                       |
| `msa_tool_calls_total`             | `gen_ai_tool_name`, `msa_outcome` (`ok`, `error`)                                    | Tool calls; failures have `msa_outcome="error"`                    |
| `msa_orchestrator_threads_active`  | none                                                                                 | Orchestrator threads running now                                   |
| `msa_pr_watch_ci_duration_seconds` | `msa_ci_conclusion` (`passed`, `failed`)                                             | Histogram of how long a watched pull request's checks were pending |

Metrics carry no task or thread ids; find those in the traces.

## Logs

| Log body                    | When                                                      | Attributes                                                                  |
| --------------------------- | --------------------------------------------------------- | --------------------------------------------------------------------------- |
| `msa.orchestrator.report`   | A thread reports its result                               | `msa.task.id`, `msa.thread.role`, `msa.report.status`, `msa.report.text`    |
| `msa.orchestrator.replan`   | A replan finishes or aborts                               | `msa.replan.reason`, counts of stopped, created, dropped, and started tasks |
| `msa.pr_watch.notification` | `pr_watch` tells the session about a change or its status | `msa.pr_watch.label`, `msa.pr_watch.text`, `msa.pr_watch.wake`              |
| `msa.tool.failed`           | A tool call fails                                         | `gen_ai.tool.name`, `error.message`                                         |
| `msa.llm.retry`             | A model call is retried                                   | `msa.retry.attempt`, `msa.retry.max_attempts`, `error.message`              |

Logs written inside a span carry its `trace_id` and `span_id`, and Grafana links them to the trace.

## Reading it in Grafana

Open `http://localhost:3000`; the container signs you in anonymously. From another machine, forward the port first with `ssh -L 3000:localhost:3000 <host>`. Use **Explore** and pick a data source:

| Question                                | Data source | Query                                                                                                            |
| --------------------------------------- | ----------- | ---------------------------------------------------------------------------------------------------------------- |
| Recent tasks and how long they took     | Tempo       | `{resource.service.name="msa" && name="msa.task"}`                                                               |
| Everything one task did                 | Tempo       | `{span.msa.task.id="t-..."}`                                                                                     |
| Cost per model today                    | Prometheus  | `sum by (gen_ai_request_model) (increase(msa_llm_cost_USD_total[1d]))`                                           |
| Slowest models                          | Prometheus  | `histogram_quantile(0.9, sum by (le, gen_ai_request_model) (rate(msa_llm_request_duration_seconds_bucket[1h])))` |
| Tools that fail                         | Prometheus  | `sum by (gen_ai_tool_name) (msa_tool_calls_total{msa_outcome="error"})`                                          |
| How long CI keeps pull requests waiting | Prometheus  | `histogram_quantile(0.5, sum by (le) (rate(msa_pr_watch_ci_duration_seconds_bucket[1d])))`                       |
| Why tools failed                        | Loki        | `{service_name="msa"} \|= "msa.tool.failed"`                                                                     |
| What the orchestrator reported          | Loki        | `{service_name="msa"} \|= "msa.orchestrator.report"`                                                             |
