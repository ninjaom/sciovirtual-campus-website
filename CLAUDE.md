# ScioVirtual Campus

Campus is ScioVirtual's app for ScioCamp students, instructors and directors (admins), served at campus.sciovirtual.org. It replaces the Google Sheets / Apps Script backend. Registration and PayPal stay on sciovirtual.org (Webflow).

The source of truth for every decision is the planning doc and the mockup canvas:
- Planning doc: https://claude.ai/code/artifact/d8667c07-e381-4354-9ceb-5b17e2824dc1
- Mockups: https://claude.ai/artifact/JxBMNsZVzGeq6DkGWjmFtx

If the code, the doc and the mockups disagree, stop and ask Om. Do not pick one.

## Working rules (always)

- Work in Plan mode. Propose each step and wait for Om's approval before writing code.
- Ask when anything is unclear. Asking too much is better than assuming. Do not proceed if even slightly unsure.
- Never change anything live without Om's explicit approval for that specific change. This includes sciovirtual.org, Webflow, DNS, the real Supabase project and campus.sciovirtual.org.
- Once Om approves a step, commit it directly to main. No separate branches are needed. Om then checks the result on the test site (the Cloudflare Pages address).
- Never commit secrets (keys, passwords, tokens). They go in environment variables or Supabase/Cloudflare settings only.

## Wording

- Om decides all wording. Use only text that appears in the approved mockups.
- Any text not in the mockups (labels, errors, empty states, emails, page titles) is written in [square brackets] so Om can approve it.
- Leave Om's own brackets as they are: [Midpoint/Final] and [URGENT].

## Privacy (enforced in the database, not just hidden on the page)

- Permissions are row-level security rules in Postgres. A student's browser must never be able to fetch another student's data.
- Zoom host email and password: readable only by that course's instructors and admins.
- Never store camp Gmail passwords, GooseChase passwords, home addresses, birthdays or parent phone numbers.
- Every security rule gets an automated test (e.g. a student account cannot read another student's grades or any Zoom host credentials).
- Most users are 10–14. Collect nothing beyond what the planning doc lists.

## Stack

- React + Vite + TypeScript, built as a static app on Cloudflare Pages.
- Supabase: Postgres, auth, storage. Two projects: "test" (fake data only) and "real" (filled only at launch, with Om's approval).
- Database changes only through migration files in `supabase/migrations`.
- Stay on free tiers. Avoid server functions except where the doc calls for them (password-reset email, Cloudflare analytics).

## Design

- Follow the "Design rules" section of the planning doc and match the mockups.
- Poppins. Blues #5166D6 / #4054DC / #3B53D9 / #3B4CC0, lavender #D7DDFF, teal #44CAB2 / #DDF5F0 / dark teal #17695A, background #F4F5FC, text #202525 / #5A5F6B.
- Corners 8 / 12 / 20 / fully round. Three button looks only. Respect reduced motion and larger text sizes.

## Build order

Follow the "Build plan" section of the planning doc, one phase at a time.
