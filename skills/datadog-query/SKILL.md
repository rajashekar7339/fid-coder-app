---
name: Write Datadog queries
description: Build and fix Datadog log, metric, event, and aggregate queries. Use when a query returns nothing, returns too much, or needs a facet, tag, or time range.
version: 1.0.0
---

# Write Datadog queries

Use this skill when a Datadog tool returns no rows, too many rows, or an error, or when you need a query for a service, environment, version, host, error type, HTTP status, metric, or deploy event.

The tools pass the query to Datadog. They do not rewrite it, so a precise query is the difference between a useful answer and a timeout. Native and browser tools use the same log query syntax; browser mode returns a page sample.

## Start with the four filters

Most troubleshooting queries are built from these:

```text
service:checkout-api
env:prod
version:2.14.0
status:error
```

Add a time window in the tool, not in the query:

```text
from: 30m
to: now
```

## Log queries

Use `@` for a log attribute that is not a reserved facet:

```text
@http.status_code:500
@http.status_code:[500 TO 599]
@error.type:NullPointerException
@duration:>1000000000
@usr.id:acme-123
```

Use quotes for a phrase and `*` for a wildcard:

```text
"connection reset by peer"
service:checkout-*
@http.url:"/api/v1/checkout"
```

Combine with `AND`, `OR`, and `NOT`:

```text
service:checkout-api AND status:error AND NOT version:2.13.3
```

Search a trace across services:

```text
trace_id:abc123 OR @trace_id:abc123
```

Search a logger or a message template:

```text
@logger.name:com.acme.CheckoutService
"failed to apply discount"
```

Use `status:error` for Datadog's status field. Use `@http.status_code:5*` when the service logs a status attribute but does not set status. Use both when you are unsure:

```text
service:checkout-api AND (status:error OR @http.status_code:5*)
```

## Grouping the sample

The browser tools do not expose a facet aggregate. `datadog_browser_error_summary` groups the captured sample by message and service. To see a facet view, use the Log Explorer's Group by control or narrow the query; the tool returns the page's loaded sample, not a total.

## Metric pages

Metrics are not a structured tool. Use `browser_navigate` to the metric page and `browser_snapshot` to read it. The query bar uses `aggregation:metric{tags} by {dimension}`:

```text
avg:system.cpu.user{service:checkout-api} by {host}
p95:trace.http.request.duration{service:checkout-api,env:prod} by {version}
sum:trace.http.request.errors{service:checkout-api,env:prod}.as_count()
max:jvm.heap_memory{service:checkout-api} by {host}
```

Common aggregations: `avg`, `sum`, `min`, `max`, `p50`, `p75`, `p95`, `p99`, `count`. Start with a 1–6 hour window; a 7-day window is usually too coarse for a deploy regression.

## Event pages

Use these in the Datadog Events search page, read with `browser_navigate` and `browser_snapshot`:

```text
source:deployment
source:deployment service:checkout-api
tags:env:prod
priority:normal
```

Search deploys around the first error, then compare the deployed version with the version in the logs.

## When a query returns nothing

Remove filters one at a time, in this order:

1. Drop `version`.
2. Drop `host` and `@usr.*`.
3. Replace a quoted phrase with a single distinctive word.
4. Replace `status:error` with `@http.status_code:5*`.
5. Widen the window from 15m to 1h to 6h.
6. Drop the service filter and group by `service` to see whether the name is different.

If the service name is uncertain, aggregate `status:error` by `service` and use the exact value from the result.

## Pitfalls

- Tag values with spaces need quotes: `env:"staging us"`.
- A bare word searches the message and known facets. A facet needs its prefix.
- A wildcard at the start of a term is expensive; narrow the time window first.
- `service:` is a reserved facet. A custom service field may be `@service`.
- Do not put `from` or `to` inside the query; pass them as tool arguments.
- Times in the report are UTC, even when the user speaks in local time.

For a longer cookbook, read `reference.md` beside this skill with `skill_read`.
