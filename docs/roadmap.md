# THE BUILD ROADMAP

### WEEK 1 — Foundation & Identity

**Exit Criteria:** All 20 tasks reviewed and approved; `npm test` and `npm run e2e` green; two users in different organizations can never see each other's rows, proven by a real cross-tenant isolation test against the database.

- [ ] Project scaffold and test harness
- [ ] The OKLCH token system and both themes
- [ ] UI kit — Button, Input, Card, Badge, Spinner
- [ ] Verification code input and risk severity pills
- [ ] Internationalisation and RTL
- [ ] Supabase local and the tenancy schema
- [ ] JWT organisation claims and the membership fallback
- [ ] Identity tables — devices, codes, rate limits, audit
- [ ] Organisation lifecycle functions
- [ ] The one-time code lifecycle
- [ ] Device trust functions
- [ ] The cross-tenant isolation proof
- [ ] Supabase clients
- [ ] The auth module
- [ ] Signup and verify screens
- [ ] Password reset that revokes device trust
- [ ] Login and the new-device challenge
- [ ] Onboarding and the verified-session guard
- [ ] End-to-end auth journeys
- [ ] Visual, accessibility and token audits

### WEEK 2 — Document pipeline & reader

**Exit Criteria:** A bilingual PDF or DOCX renders clause-by-clause with correct per-clause direction, in both Arabic and English.

- [ ] Write the design spec and implementation plan for the document pipeline and clause reader

### WEEK 3 — Analysis

**Exit Criteria:** Analyzing a contract produces summary, extracted fields, risk findings and an obligations calendar; re-analyzing an unchanged document is a cache hit.

- [ ] Write the design spec and implementation plan for contract analysis

### WEEK 4 — Citation-locked chat

**Exit Criteria:** Every chat answer carries a `[n]` citation that jumps to the source clause; a question with no answer in the document returns NOT_FOUND rather than a guess.

- [ ] Write the design spec and implementation plan for the citation-locked chat

### WEEK 5 — Product helper & polish

**Exit Criteria:** The site chatbot answers product questions from the curated docs corpus only, structurally unable to reach user rows or secrets; full bilingual and accessibility polish pass complete.

- [ ] Write the design spec and implementation plan for the product helper assistant and the polish pass
