# Atom Edit — working rules

## MANDATORY: keep the About manual and its PDF in sync
Every time ANY feature, screen, UI component, database schema, API/vault service or workflow is added, changed or removed:
1. Update `lib/about.ts` (sections text, and bump `ABOUT_UPDATED` / `ABOUT_VERSION`) in the same commit.
2. Update the diagrams in `components/about-diagrams.tsx` if the workflow or architecture changed.
3. The About screen, its "Export PDF" and the Gemini assistant's knowledge base all read from those two files, so no other manual edit is needed.
4. Mention in the commit message that the manual was updated.

## Other rules
- Never put secret keys (service_role, DB password, API keys) in code or in GitHub; API keys go in the app's API Key Vault or Vercel env vars.
- Brand name is "Atom Edit" (formerly "ips-edit"). Internal identifiers (repo name, localStorage keys `ips-*`, worker env vars `IPS_*`, Drive folder `IPS_Models`) are intentionally unchanged.
- `next build` cannot run in the sandbox (Google Fonts blocked); use `npx tsc --noEmit`.
