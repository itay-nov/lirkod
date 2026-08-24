import type { NextConfig } from "next";

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
const supabaseHostname = supabaseUrl === undefined ? null : new URL(supabaseUrl).hostname;

const nextConfig: NextConfig = {
  // The dev-tools badge defaults to bottom-left, which is exactly where the
  // bottom tab bar's last tab sits in this RTL layout — it covers a real
  // control and intercepts clicks on it during `npm run dev` and `test:e2e`.
  // Moved rather than disabled: it still reports build errors and route type,
  // just from a corner nothing occupies. Dev only; no effect on the build.
  devIndicators: { position: "top-left" },
  images: {
    // Restrict optimized remote images to this deployment's own public flyer
    // bucket. The URL carries its configured local port too, so isolated
    // worktrees do not need a second hardcoded localhost entry.
    remotePatterns:
      supabaseUrl === undefined
        ? []
        : [new URL("/storage/v1/object/public/dance-flyers/**", supabaseUrl)],
    dangerouslyAllowLocalIP:
      supabaseHostname === "127.0.0.1" || supabaseHostname === "localhost",
  },
};

export default nextConfig;
