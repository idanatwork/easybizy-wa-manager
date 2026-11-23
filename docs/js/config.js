/* Configuration.
   WORKER_URL: base URL of the deployed Cloudflare Worker (no trailing slash),
   e.g. "https://wa-manager.<you>.workers.dev". Leave empty to run the console
   in demo mode with sample data (no real API calls).
   GOOGLE_CLIENT_ID: OAuth 2.0 web client ID from Google Cloud Console
   (console.cloud.google.com -> Credentials). Not a secret. Needed once
   WORKER_URL is set; sign-in is Google-only. */
const CONFIG = {
  WORKER_URL: "https://wa-manager.idanatwork.workers.dev",
  GOOGLE_CLIENT_ID: "560597118963-pf9ng7eiibfqjsseipi7nqlabpvn83a5.apps.googleusercontent.com",
};
