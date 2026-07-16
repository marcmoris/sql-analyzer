import type { NextConfig } from 'next';

const nextConfig: NextConfig = {
  serverExternalPackages: ['mssql'],
  // Allow HMR websocket to work when accessing via IP or hostname (not just localhost)
  allowedDevOrigins: ['10.10.10.14'],
};

export default nextConfig;
