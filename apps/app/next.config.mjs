/** @type {import('next').NextConfig} */
const nextConfig = {
  output: 'standalone',
  transpilePackages: ['@life/shared', '@life/ui'],
};

export default nextConfig;
