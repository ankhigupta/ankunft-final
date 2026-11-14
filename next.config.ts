import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  /* config options here */
  cacheComponents: true,
  partialPrefetching: true,
  /**
   * `next dev` only trusts the hostname it was started with (localhost). Opened from any other hostname, such
   * as 127.0.0.1, the address printed as "Network", or an editor's preview, its dev WebSocket is refused and
   * the page never hydrates: the server-rendered HTML shows and native inputs work, but no React handler
   * (preset buttons, tabs, "Mark as done") ever runs, with no error in the console. Development only; this does
   * not affect `next build` or `next start`.
   */
  allowedDevOrigins: ["127.0.0.1", "192.168.*.*"],
};

export default nextConfig;
