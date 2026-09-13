# Intent — Personal Life API

Date: 2026-09-14
Status: Confirmed by user

## North star (long term)

An agent living on a personal data substrate that can answer questions across domains,
make recommendations about one's life, and — after explicit user approval — take actions
in other apps within a self-grown ecosystem.

## Current goal

Centralize life data into **one personal API** the user owns. Stop hopping between apps.
The substrate must come first, because no agent is useful without it.

## Scope of this build (domain #1: notes)

- Notes/journaling as the seed domain, stored in a self-owned API.
- Captured and read from a mobile-first UI (phone primary).
- Notes are **freeform text with light, consistent tags and timestamps** — deliberately
  unstructured, because the user does not yet know what to track.
- The notes corpus is the future input for mining themes and recommending the next domain.

## User

The user alone. Single-user system; no multi-user concerns.

## Why now

Fragmentation is a real daily cost, and the substrate is a prerequisite for the long-term
agent goal, so centralizing is the correct first move.

## Success (v1)

Notes live in the user's own API, tagged and timestamped consistently, captured from a
phone in seconds. The corpus is deliberately freeform and lightly tagged so it can be mined
later.

## Constraints

- Cost-conscious: zero recurring cost initially; local host + Tailscale.
- Laptop must be on/awake for access (accepted).
- Agent, cross-domain recommendations, and write-actions to other apps are **north star,
  not v1**.

## Out of scope (v1)

- The agent itself.
- Cross-domain recommendations.
- Actions that change other apps.
- A second data domain. **Domain #2 will be chosen later from patterns found in notes**,
  not decided now.

## Consequence for design

Because domain selection is deferred until the notes reveal it, the v1 data model must not
over-constrain. This is exactly why notes-only plus tags is the right seed: it produces real
data without committing the shape of the eventual generic core.
