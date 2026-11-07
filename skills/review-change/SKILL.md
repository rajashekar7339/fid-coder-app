---
name: Review a change
description: Review a diff for bugs, safety, load, missing tests, speed, and code that should not exist. Report findings and do not edit.
version: 1.0.0
---

# Review a change

Adapted from Ponytail by Dietrich Gebert (MIT).

## When to use

Use this skill when the user asks for a code review, a review of a diff, a branch, a pull request, or uncommitted changes. For normal implementation work, follow the agent's own instructions or invoke the write-lean skill with `/skills write-lean <task>`.

Review like the person who will be paged when this breaks. Order of importance: correct, safe, holds under the expected load, tested, fast, then lean. This is a report. Do not edit files, commit, push, or post a review.

## 1. Understand first

- Review what the user names: uncommitted changes, staged changes, a branch, a pull request, or files. If nothing is named, review the uncommitted changes, or the last commit when the work tree is clean.
- Read the diff, then the code it touches: callers of every changed function, the functions it calls, and the tests.
- Trace the real flow: where data comes in, what is stored, and what goes out.
- A change can break code it does not touch. When a signature, return value, or behavior changes, search every caller.
- Judge scale against the load this project expects, and say which load you assumed.

## 2. Look for

1. Bug: a wrong result, a crash, a missed edge case, a caller broken by the change, or a fix applied in one caller while the shared function stays broken.
2. Risk: injection, secrets, missing checks on user input, or data loss from a swallowed error or a write in the wrong order.
3. Scale: a check-then-write race, work repeated by every process, a list that only grows, a query per item, or O(n^2) on a large input.
4. Missing test: risky new logic with no test that fails when it breaks. One good test is enough.
5. Speed: a large slowdown is a problem. A small win is a suggestion.
6. Lean: dead code, a helper the repo already has, a dependency added for a few lines, an abstraction with one implementation, or near-copies that must change together.

## 3. Check before you report

- Every finding needs a concrete case: this input or situation leads to this wrong result. No case, no finding.
- Re-read the lines and confirm the caller exists and the value can really arrive.
- A `shortcut:` comment that names its limit is a decision, not a finding, unless the expected load already crosses that limit.
- Propose the smallest fix. Prefer a fix that deletes code.
- No style taste and no vague worries.

## 4. Output

Use short sentences. Explain a technical term the first time you use it.

Start with `What this change does:` in two or three sentences.

Then the findings in three groups. Skip empty groups:

- Must fix: a bug, a security hole, data loss, or a break at the expected load.
- Should fix: risky code without a test, real slowness, or code that should not exist.
- Nice to have: a small speed-up or a shorter form.

Number the findings across all groups. Each finding has a title with `path:lines`, then four parts of one or two sentences: What this is, Problem, Fix, and If we skip it.

End with `Verdict: Ship.` or `Verdict: fix 1 and 3 first.` Add `Not checked:` on one line when something mattered and you could not check it.

When nothing is wrong: `What this change does:`, then `Looks good. Ship.` and one line on what you checked.
