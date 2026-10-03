/** @type {import('next').NextConfig} */
const nextConfig = {
  output: 'standalone',
  transpilePackages: ['@life/shared', '@life/ui', '@life/app-kit', '@life/nutrition'],
};

export default nextConfig;
