/** All server-side configuration comes from environment variables (see .env.example). */
const env = (name: string) => (process.env[name] ?? '').trim();

export const config = {
  /** Shared secret that protects the API. If empty, the API is open (dev only). */
  accessKey: () => env('IPS_ACCESS_KEY'),
  /** Secret placed in webhook URLs so only your provider can call them. */
  webhookSecret: () => env('WEBHOOK_SECRET') || env('IPS_ACCESS_KEY'),
  /** Public https URL of this app, used to build webhook URLs for providers. */
  publicBaseUrl: () => {
    const explicit = env('PUBLIC_BASE_URL');
    if (explicit) return explicit.replace(/\/$/, '');
    const vercel = env('VERCEL_PROJECT_PRODUCTION_URL') || env('VERCEL_URL');
    return vercel ? `https://${vercel}` : '';
  },
  videoProvider: () => env('VIDEO_PROVIDER') || 'mock',
  voiceProvider: () => env('VOICE_PROVIDER') || 'mock',
  maxScenes: () => Number(env('MAX_SCENES')) || 60,
  /** How many scenes may run at the same time on the provider. */
  maxParallel: () => Number(env('MAX_PARALLEL')) || 6,
  supabaseUrl: () => env('SUPABASE_URL') || env('NEXT_PUBLIC_SUPABASE_URL'),
  supabaseServiceKey: () => env('SUPABASE_SERVICE_ROLE_KEY'),
  falKey: () => env('FAL_KEY'),
  falModel: () => env('FAL_VIDEO_MODEL') || 'fal-ai/wan/v2.2-5b/image-to-video',
  runpodKey: () => env('RUNPOD_API_KEY'),
  runpodVideoEndpoint: () => env('RUNPOD_VIDEO_ENDPOINT_ID'),
  runpodVoiceEndpoint: () => env('RUNPOD_VOICE_ENDPOINT_ID'),
};
