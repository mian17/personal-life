/** @type {import('next').NextConfig} */
const nextConfig = {
  output: 'standalone',
  transpilePackages: [
    '@life/shared',
    '@life/ui',
    '@life/app-kit',
    '@life/nutrition',
    '@life/pomodoro',
  ],
  experimental: {
    serverActions: {
      /**
       * Next's 1 MB default is under a phone capture (2–5 MB); the number is not
       * ours — `JSON_BODY_LIMIT` in `apps/meal-service/src/app.factory.ts` owns it,
       * and equal values make that cap bind first (base64 is a third larger).
       * `test/server-action-body-limit.test.ts` fails if the two drift.
       */
      bodySizeLimit: '8mb',
    },
  },
};

export default nextConfig;
