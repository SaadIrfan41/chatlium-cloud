# Chatlium: Agent Observability and Usage Tracking

This addendum adds two things to the architecture baseline:

1. **Operational observability** for the AI pipeline (traces, metrics, logs), for the engineer running Chatlium.
2. **Usage visibility** for workspace users: how many tokens and how much estimated cost each conversation and run consumed, shown in the dashboard.

It does not add billing. There is no credit balance, invoicing, or payment flow. Those remain out of scope. Usage data recorded here could later become the input to billing, but building that is a separate project.

---

## 1. Why two systems

Operational telemetry and user-facing usage answer different questions and have different requirements.

| | Operational telemetry | User-facing usage |
|---|---|---|
| Question | Is the system healthy, and where is time and money going? | How much did this conversation or run cost, and what happened in it? |
| Audience | Engineer, on-call | Workspace operator |
| Granularity | Aggregates, plus individual traces for debugging | Each run and each LLM call |
| Storage | OpenTelemetry → collector → Prometheus (metrics), tracing backend (traces) | PostgreSQL, scoped by workspace with RLS |
| Retention | Short for traces, longer for aggregates | Matches the conversation retention policy |

The rule that follows: **do not use Prometheus as the source for per-run or per-workspace cost.** Putting run IDs or workspace IDs into metric labels creates unbounded cardinality and will degrade the monitoring stack. Prometheus holds aggregates. PostgreSQL holds the per-run truth. Traces link the two through a shared trace ID.

---

## 2. What is measured

### Per LLM call
- Provider and model name
- Input tokens, output tokens
- Estimated cost, stored as an integer in micro-units (for example, millionths of a US dollar) to avoid floating-point error
- Price table version used for the estimate
- Latency to first token and total duration
- Finish reason (completed, length limit, error, timeout)
- Whether the call used the platform key or a workspace's BYOK key (the key's identifier, never the key)

### Per embedding call (indexing and query)
- Model name, tokens processed, estimated cost, duration
- Document ID or query ID

### Per execution (one run triggered by a message)
- Sum of token counts and estimated cost across its LLM and embedding calls
- Total duration, and status (completed, escalated, failed)
- Workflow ID and version
- Count of retrieval calls and tool calls

### Per node step
- Node type, start and end time, status
- For Knowledge nodes: document references, chunk IDs, similarity scores
- For Condition nodes: the rule evaluated and the result
- For Action nodes: the action taken and whether it was skipped as a duplicate
- For tool calls: tool name, input schema version, result status, duration

### Per conversation
- Rollup of its executions: total tokens, total estimated cost, message count, escalation status

### What is not stored
- Model "reasoning" or private chain-of-thought. Store the observable inputs, outputs, and decisions instead.
- Prompt and response contents in traces by default. Contents may be stored in the conversation history the product already keeps, but traces carry identifiers, counts, and durations only.
- Keys, tokens, or any secret, in any telemetry or usage record.

---

## 3. Data model additions

| Table | Purpose | Key fields |
|---|---|---|
| `llm_calls` | One row per model call | `id`, `workspace_id`, `execution_step_id`, `provider`, `model`, `input_tokens`, `output_tokens`, `cost_micros`, `price_version`, `key_ref`, `duration_ms`, `ttft_ms`, `finish_reason`, `trace_id`, `created_at` |
| `embedding_calls` | One row per embedding batch | `id`, `workspace_id`, `document_id`, `model`, `tokens`, `cost_micros`, `price_version`, `duration_ms`, `created_at` |
| `execution_steps` (extended) | Node-level detail | Adds `cost_micros`, `tokens_total`, `trace_id`, `span_id` |
| `executions` (extended) | Run-level rollup | Adds `cost_micros`, `tokens_total`, `duration_ms`, `trace_id` |
| `model_prices` | Price table, versioned | `provider`, `model`, `input_micros_per_1k`, `output_micros_per_1k`, `effective_from`, `version` |

Rules:
- Rollups are computed when a run finishes, inside the same transaction that records the run's final status. Never recompute cost from scratch in the dashboard.
- Prices are looked up from `model_prices` at call time and the version is stored with the row. Historical costs never change when prices change.
- Every row carries `workspace_id`, and every table is covered by the same row-level security policy as the rest of the tenant data.
- Cost is labeled **estimated**, because provider billing and the price table can differ.

---

## 4. Telemetry pipeline

```
Web and worker processes
   │  OpenTelemetry SDK (traces, metrics)
   │  Vercel AI SDK telemetry hooks (LLM call spans)
   ▼
OpenTelemetry Collector
   ├── Traces  → tracing backend (Tempo or Jaeger)
   ├── Metrics → Prometheus → Grafana
   └── Logs    → CloudWatch Logs (or Loki later)

PostgreSQL (llm_calls, executions, execution_steps)
   └── Dashboard usage views (workspace-scoped, RLS enforced)
```

Implementation notes:
- Use the Vercel AI SDK's OpenTelemetry integration for LLM spans rather than writing spans by hand. Check its current telemetry options in the SDK docs before relying on specific settings.
- Follow the OpenTelemetry GenAI semantic conventions for span and attribute names (for example, model name and token usage attributes). These conventions are still evolving, so verify the current attribute names before instrumenting, and pin the convention version in the code.
- Every span carries the trace ID. The same trace ID is written to `executions` and `llm_calls`, so a row in the dashboard can link to its trace.
- Propagate trace context across the outbox and the queue. Otherwise the trace breaks at the most interesting point, the asynchronous worker.
- Metrics exported to Prometheus use bounded labels only: provider, model, workflow node type, and outcome. Never workspace ID or run ID.

### Operational metrics to add
- Tokens per minute by provider and model
- Estimated spend per hour by provider and model
- LLM p95 latency and time to first token
- Error and timeout rate by provider
- Embedding throughput during indexing

These feed a Grafana cost panel and an alert on unusual spend, such as a sudden spike in tokens per minute.

---

## 5. User-facing usage view

Add a **Usage** section to the operator dashboard. Phase 1 includes a minimal version. Phase 6 adds the rest.

### Phase 1 (minimal)
- On each conversation: total tokens and estimated cost.
- On each escalated or answered message: the cost of the run that produced it.

### Phase 6 (complete)
- **Overview:** estimated cost and tokens for the selected date range, with a daily chart.
- **By model:** cost and tokens per provider and model, including whether BYOK or the platform key was used.
- **By conversation:** sortable list with message count, runs, cost, and escalation status.
- **Run detail:** the execution timeline. Each node shows duration, status, tokens, and cost. Retrieval steps list the documents and similarity scores. A link opens the trace.
- **Indexing costs:** embedding tokens and cost per document.

Presentation rules:
- Label every cost as estimated, and show the price table version in the footnote.
- Show costs with a fixed number of decimal places in the workspace's currency, where that is configurable. Keep the underlying micro-unit value for exports.
- Never show another workspace's data. Test this as part of the tenant isolation suite.

### Optional: soft spending limits
A per-workspace monthly soft limit can pause new AI calls and notify the operator. This is a cost-control safeguard and useful for a production system, but it is still not billing. Mark it as optional, and add it only if Phase 6 has time.

---

## 6. Additional tests

Add these to the required test list in the baseline:

- Each LLM call writes exactly one `llm_calls` row, including when it fails or times out.
- A retried job does not double-count tokens or cost. Idempotency applies to usage records too, keyed by job ID and call index.
- Run cost equals the sum of its step costs, and conversation cost equals the sum of its run costs.
- Changing a price in `model_prices` does not change any historical row.
- A workspace operator cannot read another workspace's usage data through the API or the dashboard.
- Trace ID on an `executions` row resolves to a trace containing the matching LLM spans.
- No secret, prompt content, or API key appears in any span attribute or log line. Test this against a sample run.

---

## 7. Cost of the observability stack itself

Observability isn't free, and this affects the demonstration budget.

- The collector and Prometheus add small resource requests to the cluster.
- Tempo or Jaeger stores traces, so set a short retention period (for example, 3 to 7 days) and a sampling rate.
- Grafana Cloud's free tier, or a self-hosted Grafana in the cluster, can cover the demo. Record the choice and its cost in the README.
- Sample traces at a fixed rate in the demo environment. Keep 100 percent of error traces.
- Usage records in PostgreSQL are small, but set a retention policy on `llm_calls` consistent with the conversation retention policy.

---

## 8. Scope impact on the baseline

| Phase | Addition |
|---|---|
| Phase 1 | Record tokens, cost, and trace ID on every LLM call from the first working answer. Minimal per-conversation usage view. This is cheap now and expensive to retrofit |
| Phase 2 | OpenTelemetry SDK and collector running locally. Trace context carried across the outbox and queue |
| Phase 3 | Storage for traces and metrics in the target environment, sized to the budget |
| Phase 6 | Full usage view, Grafana cost panels, spend alerts, trace links from the dashboard |

No new phase is required. The change adds a small amount of work to each phase and one dashboard section.

---

## 9. Checklist for the owner

Before Phase 1 ends:
- [ ] Price table populated for the models in use, with a version and an effective date
- [ ] Every LLM and embedding call writes a usage row
- [ ] Run and conversation rollups match their step sums in a test
- [ ] Minimal usage view shows conversation cost to the operator
- [ ] Tenant isolation test covers usage data

Before Phase 6 ends:
- [ ] Trace links open the correct trace from a run
- [ ] Grafana cost panel shows spend by model
- [ ] Spend alert fires in a test
- [ ] No secrets or prompt contents appear in telemetry, verified by sample
