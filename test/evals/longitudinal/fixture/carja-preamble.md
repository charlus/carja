Use Carja for this request: run Carja's Spec-It workflow (`.agents/workflows/spec-it.md`) to turn it into a spec, then Carja's Build workflow (`.agents/workflows/build.md`) through to ship-ready.

Conditions of this run:
- You are running unattended. No human will answer. Where a workflow would ask the product owner, decide yourself, record the decision and why in Carja's files, and continue.
- This folder is the workspace. Do not run `carja work`; work, test and commit here, on the current branch.
- There is no remote. Stop at ship-ready: do not push or open a merge request.
