# Datadog triage report

```text
Symptom:
  One sentence. Name the service, environment, and what users see.

Window (UTC):
  2026-11-20 14:00 – 14:30 UTC

Query:
  service:checkout-api status:error

Evidence:
  - 128 errors between 14:03 and 14:28; 94 on version 2.14.0.
  - TypeError: Cannot read properties of undefined (reading 'price')
    at applyDiscount (src/checkout.ts:42:18)
  - Deploy event for 2.14.0 at 13:58 UTC; no errors on 2.13.3.

Root cause:
  src/checkout.ts:42 reads order.items[0].price without checking for an
  empty items array. The new request path allows an empty cart.

Confidence:
  High. The error starts after the deploy, the stack points at the line,
  and the input path can produce an empty array.

Fix:
  Return the no-discount path when items is empty, and add a test for an
  empty cart.

Verify:
  service:checkout-api status:error should return to the pre-deploy rate,
  and the p95 latency should stay flat.
```
