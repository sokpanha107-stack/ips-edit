/** All server-side configuration comes from environment variables (see .env.example). */
const env = (name: string) => (process.env[name] ?? '').trim();

export const config = {
    /** Secret placed in webhook URLs so only your provider can call them. */
  webhookSecret: () => env('WEBHOOK_SECRET'),
  /** Public https URL of this app, used to build webhook URLs for providers. */
  publicBaseUrl: () => {
    const explicit = env('PUBLIC_BASE_URL');
    if (explicit) return explicit.replace(/\/$/, '');
    const vercel = env('VERCEL_PROJECT_PRODUCTION_URL') || env('VERCEL_URL');
    return vercel ? `https://${vercel}` : '';
  },
  maxScenes: () => Number(env('MAX_SCENES')) || 60,
  /** How many scenes may run at the same time on the provider. */
  maxParallel: () => Number(env('MAX_PARALLEL')) || 6,
  supabaseUrl: () => env('SUPABASE_URL') || env('NEXT_PUBLIC_SUPABASE_URL'),
  supabaseServiceKey: () => env('SUPABASE_SERVICE_ROLE_KEY'),
  /** Secret that encrypts the users' API keys at rest (AES-256-GCM). Generate: openssl rand -base64 32 */
  vaultSecret: () => env('VAULT_ENCRYPTION_KEY'),
  /** Web Push (VAPID). Generate once: npx web-push generate-vapid-keys */
  vapidPublic: () => env('NEXT_PUBLIC_VAPID_PUBLIC_KEY'),
  vapidPrivate: () => env('VAPID_PRIVATE_KEY'),
  vapidSubject: () => env('VAPID_SUBJECT') || 'mailto:admin@localhost.invalid',
  /** Where the free Python tools (gTTS, deep-translator) run: the Vercel Python functions in /api/py by default. */
  pythonBase: () => env('PYTHON_API_URL') || `${env('PUBLIC_BASE_URL') ? env('PUBLIC_BASE_URL').replace(/\/$/, '') : (env('VERCEL_PROJECT_PRODUCTION_URL') ? `https://${env('VERCEL_PROJECT_PRODUCTION_URL')}` : 'http://localhost:3000')}/api/py`,
};
