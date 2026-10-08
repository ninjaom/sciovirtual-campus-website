# ScioVirtual Campus

The app for ScioCamp students, instructors and directors, at campus.sciovirtual.org.

- Rules for working on this repo: `CLAUDE.md`
- Stack: React + Vite + TypeScript on Cloudflare Pages, Supabase for the database, sign-in and file storage.

## Local development

1. `npm install`
2. Copy `.env.example` to `.env.local` and fill in the **test** project's URL and publishable key.
3. `npm run dev`

## Server functions

`functions/api/*` run on Cloudflare Pages (sign-up with a setup code, forgot password). They need these
settings in Cloudflare Pages → Settings → Variables and Secrets (never in the repo):

- `SUPABASE_URL`: the Supabase project URL
- `SUPABASE_SERVICE_ROLE_KEY`: the project's **secret** key (encrypt it)
- `SITE_URL`: the site address, used in reset links
- `RESEND_API_KEY` and `MAIL_FROM`: the email service for reset links

## Database

- Changes: `supabase/migrations` only.
- Privacy tests: `supabase/tests/security_test.sql`, run automatically by GitHub Actions on every push.
- Fake data for the test project: `supabase/seed/test_accounts.sql` (test project only).
