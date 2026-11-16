# IPS Edit · multi-tenant setup (one time)

1. **Supabase → SQL Editor**: paste `supabase/schema.sql`, Run. (Tables, RLS on every table, private `documents` bucket + storage policies.)
2. **Supabase → Authentication → Providers → Google**: enable, paste Google OAuth client ID/secret.
   **Authentication → URL Configuration**: Site URL = your Vercel URL; Redirect URLs add `https://YOUR-APP/auth/callback`.
3. **Supabase → Authentication → Passkeys** (experimental): enable; Relying Party ID = your bare domain (e.g. `ips-edit.vercel.app`), Origins = `https://ips-edit.vercel.app`.
4. **Vercel → Environment Variables** (see `.env.example`):
   `NEXT_PUBLIC_SUPABASE_URL`, `NEXT_PUBLIC_SUPABASE_ANON_KEY`, `SUPABASE_SERVICE_ROLE_KEY`, `VAULT_ENCRYPTION_KEY` (`openssl rand -base64 32`),
   `NEXT_PUBLIC_VAPID_PUBLIC_KEY` + `VAPID_PRIVATE_KEY` (`npx web-push generate-vapid-keys`), `VAPID_SUBJECT`, `PUBLIC_BASE_URL`.
5. Redeploy, open the app, sign in, then **Settings → API Key Vault** to add RunPod / Premium Voice keys and **Account & Notifications** to turn on push.

Free Python tools run as Vercel Python functions: `api/py/tts.py` (gTTS) and `api/py/translate.py` (deep-translator); dependencies in `requirements.txt`.
