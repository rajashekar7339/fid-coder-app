# Datadog query cookbook

## Log search recipes

| Goal | Query |
|---|---|
| All errors for a service | `service:checkout-api status:error` |
| HTTP 5xx when status is not set | `service:checkout-api @http.status_code:[500 TO 599]` |
| One exception class | `service:checkout-api @error.type:NullPointerException` |
| One customer | `service:checkout-api @usr.id:acme-123` |
| One endpoint | `service:checkout-api @http.url:"/api/v1/checkout"` |
| One host | `service:checkout-api host:checkout-7f9c` |
| One version | `service:checkout-api version:2.14.0` |
| A trace across services | `trace_id:abc123 OR @trace_id:abc123` |
| A message phrase | `service:checkout-api "connection reset by peer"` |
| Errors but not a known version | `service:checkout-api status:error AND NOT version:2.13.3` |
| Timeout-shaped errors | `service:checkout-api (timeout OR "timed out" OR DeadlineExceeded)` |
| Auth-shaped errors | `service:checkout-api (401 OR 403 OR Unauthorized OR Forbidden)` |

## Aggregate recipes

| Question | Query | groupBy |
|---|---|---|
| Which service is noisiest? | `status:error` | `["service"]` |
| Which error types dominate? | `service:checkout-api status:error` | `["@error.type"]` |
| Did a version regress? | `service:checkout-api status:error` | `["version"]` |
| Is it one host? | `service:checkout-api status:error` | `["host"]` |
| Which endpoint is failing? | `service:checkout-api status:error` | `["@http.url", "@http.status_code"]` |
| Which environment? | `service:checkout-api status:error` | `["env"]` |

## Metric recipes

These are for the Datadog metric page. There is no structured metric tool; use `browser_navigate` and `browser_snapshot`.

| Goal | Query |
|---|---|
| Error rate | `sum:trace.http.request.errors{service:checkout-api,env:prod}.as_count()` |
| Request count | `sum:trace.http.request.hits{service:checkout-api,env:prod}.as_count()` |
| p95 latency | `p95:trace.http.request.duration{service:checkout-api,env:prod} by {version}` |
| CPU by host | `avg:system.cpu.user{service:checkout-api,env:prod} by {host}` |
| Memory by host | `avg:system.mem.used{service:checkout-api,env:prod} by {host}` |
| JVM heap | `avg:jvm.heap_memory{service:checkout-api,env:prod} by {host}` |
| Container restarts | `sum:kubernetes.containers.restarts{service:checkout-api,env:prod}.as_count()` |
| Dependency latency | `p95:trace.http.request.duration{service:payments-api,env:prod}` |
| Log error count | `sum:logs.error.count{service:checkout-api,env:prod}` (only if the org emits this metric) |

## Event recipes

| Goal | Query |
|---|---|
| Deploys for a service | `source:deployment service:checkout-api` |
| Deploys in an environment | `source:deployment tags:env:prod` |
| Config changes | `source:configuration` |
| Feature flag changes | `source:feature_flags` |
| All high-priority events | `priority:high` |
| Events for an alert | `monitor_id:123456` |

## Reading a result

For each log row, note:

- `status`, `service`, `env`, `version`, `host`
- `@error.type`, `@error.message`, `@error.stack`
- `@http.method`, `@http.status_code`, `@http.url`
- `@logger.name`
- `trace_id`, `span_id`

A stack frame in the workspace is the strongest clue. A frame in a library means the bug may be in how the workspace calls it. A missing stack means the service logs the message after catching the exception; search for the logger name and the catch block.

## Costs and limits

- Narrow the time window before widening the query.
- `datadog_browser_error_summary` groups the captured page sample.
- `datadog_browser_logs` returns a page sample, not a total.
- Browser results are sampled. Their counts are not exact totals.
- Keep `limit` low when exploring. Raise it only after the query is precise.
