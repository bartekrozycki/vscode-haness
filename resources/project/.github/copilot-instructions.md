# Project SDLC

Use the project-owned harness documented in `.work-item/README.md` when the user
asks for SDLC task management. Tasks, history, metrics, questions and lessons live
in `.work-item/*.tsv`; requirements and reports live in Markdown. Use `sdlc_*`
tools or `python3 tools/work-items.py api` for state changes; do not edit ledgers
behind the coordinator. Never start a task without the user's approval.

Read project `AGENTS.md` and `CONTRIBUTING.md` when present. Technical choices
belong in the task handoff. Business decisions belong to the user. Keep changes
within the task's requirements. Never push or publish without a human request.

Use English for all communication, specifications, artifacts, task documents and code comments.
