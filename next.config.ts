import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // The dev-tools badge defaults to bottom-left, which is exactly where the
  // bottom tab bar's last tab sits in this RTL layout — it covers a real
  // control and intercepts clicks on it during `npm run dev` and `test:e2e`.
  // Moved rather than disabled: it still reports build errors and route type,
  // just from a corner nothing occupies. Dev only; no effect on the build.
  devIndicators: { position: "top-left" },
};

export default nextConfig;
