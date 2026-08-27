# Aqd AI — Manifesto

Aqd AI (عقد) is a bilingual, Arabic-first contract-analysis platform. A lawyer
uploads a contract, gets it segmented into clauses, summarised, risk-scored
against a legal playbook, and turned into an obligations calendar — then asks
it questions through a citation-locked chat that refuses to answer from
anything but the document itself.

## Principles

- Grounding and anti-hallucination are the product, not a feature — an answer
  with no citation in the source document is not an answer.
- Tenancy is enforced by the database through Row-Level Security, never by
  application code alone. Server code always uses the caller's own session
  client, never a service-role key.
- Risk severity is never colour alone — always a glyph and a word.
- Arabic is a first-class layout target, not a translated afterthought:
  logical CSS properties, per-clause direction, its own line-height.
- Every user-visible string lives in `messages/en.json` and `messages/ar.json`.
  No hard-coded copy, no hard-coded colour outside the token file.

## Scope

- A from-scratch rebuild, decomposed into five sub-projects: Foundation &
  Identity, Document pipeline & reader, Analysis, Citation-locked chat, and
  the Product helper assistant with polish.
- Each sub-project ships through the same pipeline: spec → design →
  implementation plan → subagent-driven build, one task at a time, with an
  independent reviewer against every diff.

## Non-Goals

- Google OAuth in sub-project 1 — deliberately deferred.
- OpenRouter or any model-routing intermediary — Anthropic and Gemini are
  called directly behind a router interface.
- A site chatbot with data tools — the product helper answers from a curated
  docs corpus only, structurally unable to reach user rows or secrets.
