---
type: 'Reference'
title: 'Quickstart'
openwiki_generated: true
verified:
  - by: openwiki/0.9.0
    at: 2026-11-26T10:12:12.781Z
sources:
  - id: openwiki-source-8037e2358a2c4f9b2c722a11
    resource: repo://AGENTS.md
  - id: openwiki-source-5b54a58d1b51cd490b0e7162
    resource: repo://package.json
  - id: openwiki-source-23775c3de52f3ab95a13cb8b
    resource: repo://README.md
generated: { by: 'pi', at: '2026-11-26T10:12:12.781Z' }
---

# Quickstart

This wiki documents the `personal-life` monorepo as it is in the tree. Start
here, then jump — every entry is a pointer, not a summary.

## By task

**"I need to understand the system."**
→ [System overview](architecture/overview.md) — topology, contracts, request path.

**"I'm changing how data is read, written or cached."**
→ [Data layer](architecture/data-layer.md) — the BE → cache → DB contract.
→ [Crypto at rest](architecture/crypto-at-rest.md) — envelopes, key hierarchy,
where plaintext may exist.

**"I'm adding UI."**
→ [Shared UI contract](architecture/ui-contract.md) — compose from `@life/ui`,
no raw HTML, gaps go upstream.

**"I'm adding or modifying a service."**
→ [Service kernel](architecture/service-kernel.md) — auth, health, paging,
batch, grants, outbox — import, don't reimplement.

**"I'm tracing a feature."**
→ [Notes lifecycle](workflows/notes-lifecycle.md) ·
[Todos and the transactional outbox](workflows/todos-and-outbox.md) ·
[Meals and nutrition](workflows/meals-and-nutrition.md) ·
[Identity and access](workflows/identity-and-access.md) ·
[Events and messaging](integration/events-and-messaging.md)

**"CI is red / I'm touching CI."**
→ [CI gates](operations/ci-gates.md) — what each workflow proves, and the
no-self-hosted-runner invariant.

**"I'm shipping."**
→ [Release and promotion](operations/release.md) — the script, the five
refusals, why promotion ≠ release.
→ [Deployment and operations](operations/deployment.md) — the compose stack,
env, backups, the hard lines.

**"I'm writing or running tests."**
→ [Testing strategy](testing/strategy.md) — suites, slot-owned e2e infra,
guard tests.

## The two contracts in one line each

1. All visuals come from `@life/ui`; apps own behavior only.
2. Every domain service is BE → cache → DB; ciphertext at rest and in the cache.

Everything else in this wiki is detail on top of those two
([System overview](architecture/overview.md)).
