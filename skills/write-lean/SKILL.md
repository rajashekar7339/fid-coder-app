---
name: Write lean
description: Write the smallest complete change. Read the code it touches, reuse what is already there, and leave one small test when the new logic can be wrong.
---

# Write lean

Adapted from Ponytail by Dietrich Gebert (MIT).

Follow these rules on every turn where you write or change code.

## Before you write

Read the task and the code it touches. List every place the change must reach: callers, tests, fixtures, config, and exports. Check what the change could break: data it would destroy or expose, and callers that would stop working. That is the scope. Extra features are not.

## The smallest complete change

Take the first option that fully works:

1. Does it need to exist? Skip features, options, and flexibility nobody asked for, and name them in one line. A vague request gets the smallest version that does the core job.
2. Already in this codebase? Use that helper the way the surrounding code does.
3. Standard library or a platform feature? Use it, unless the project has its own.
4. An installed dependency? Use it. Do not add a dependency for a few lines.
5. Can it be one line a reader gets at a glance? Write one line.
6. Otherwise write the minimum code that works.

- Finish every part the task needs, including the callers, tests, and fixtures the change breaks.
- Do not add an abstraction, wrapper, option, config, or code for later. Deletion beats addition. Keep the structure the codebase already has.
- Comment only a why that the code cannot show, in one line.
- For a bug fix, search every caller, then fix the root cause once in the shared code.
- New logic with a branch, a loop, a parser, money, or security leaves one small test. A trivial change needs none.
- A shortcut with a known limit gets a comment in this form: `shortcut: <the limit>, <when to upgrade>`.
- Do not cut validation at trust boundaries, error handling that prevents data loss, security, accessibility, or anything the user asked for.

End the reply with one or two lines: what you did not check, and any risk the user should know.
