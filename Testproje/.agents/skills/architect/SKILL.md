---
name: architect
description: "Design the structure the scope needs and restructure the code to match it"
metadata:
  freebuff-builtin: "architect"
---

# Architecture pass

Step back from the diff and design the structure the changed code actually needs — the surrounding app is out of scope unless the request asked to restructure it: which concerns deserve their own module (core logic apart from rendering, engine apart from interface, data apart from presentation), who owns each piece of state, and which direction data flows. Favor the simplest structure that keeps each concern understandable alone — boundaries are for clarity, not ceremony.

Then restructure the code to match: move logic to where it belongs, give state one owner, collapse duplicated policy, and delete indirection the structure no longer needs. Preserve behavior — this pass changes shape, not features — and verify with the project’s own checks plus a real run before finishing. Briefly record the resulting structure so later passes build with it rather than against it.