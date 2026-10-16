import type { NextConfig } from "next";
import { withSentryConfig } from "@sentry/nextjs";

import { resolveSentryRelease } from "./sentry-scrub.mjs";

const developmentScriptPolicy = process.env.NODE_ENV === "development" ? " 'unsafe-eval'" : "";

const securityHeaders = [
  {
    key: "Content-Security-Policy",
    value: [
      "default-src 'self'",
      "base-uri 'self'",
      "form-action 'self'",
      "frame-ancestors 'none'",
      "object-src 'none'",
      "img-src 'self' data: blob: https:",
      "font-src 'self' data:",
      "style-src 'self' 'unsafe-inline'",
      `script-src 'self' 'unsafe-inline' 'wasm-unsafe-eval'${developmentScriptPolicy} https://challenges.cloudflare.com`,
      "connect-src 'self' blob: https: wss:",
      "frame-src https://challenges.cloudflare.com",
      "worker-src 'self' blob:",
      "manifest-src 'self'",
      "upgrade-insecure-requests",
    ].join("; "),
  },
  {
    key: "Referrer-Policy",
    value: "strict-origin-when-cross-origin",
  },
  {
    key: "Strict-Transport-Security",
    value: "max-age=63072000; includeSubDomains; preload",
  },
  {
    key: "X-Content-Type-Options",
    value: "nosniff",
  },
  {
    key: "X-Frame-Options",
    value: "DENY",
  },
  {
    key: "Permissions-Policy",
    value: "camera=(), microphone=(), geolocation=(), payment=(), usb=()",
  },
];

const noIndexHeaders = [
  {
    key: "X-Robots-Tag",
    value: "noindex, nofollow, noarchive",
  },
];

const noIndexPaths = [
  "/account/:path*",
  "/admin/:path*",
  "/api/:path*",
  "/auth/:path*",
  "/onboarding/:path*",
  "/predictions/:path*",
  "/s/:path*",
];

const nextConfig: NextConfig = {
  allowedDevOrigins: ["127.0.0.1"],
  devIndicators: false,
  async rewrites() {
    return [{ source: "/ws/live", destination: `${process.env.LIVE_INTERNAL_ORIGIN ?? "http://127.0.0.1:3002"}/ws/live` }];
  },
  async headers() {
    return [
      {
        source: "/:path*",
        headers: securityHeaders,
      },
      {
        source: "/f1/circuits/:path*",
        has: [{ type: "query", key: "v", value: "[a-f0-9]{16}" }],
        headers: [{ key: "Cache-Control", value: "public, max-age=31536000, immutable" }],
      },
      ...noIndexPaths.map((source) => ({
        headers: noIndexHeaders,
        source,
      })),
      {
        source: "/api/og/:path*",
        headers: [
          {
            key: "X-Robots-Tag",
            value: "noindex, noarchive, max-image-preview:large",
          },
        ],
      },
    ];
  },
  images: {
    localPatterns: [
      { pathname: "/**", search: "" },
      { pathname: "/f1/circuits/**" },
      { pathname: "/f1/tracks/3d/sepang-preview.webp" },
      { pathname: "/f1/tracks/3d/miami-preview.webp" },
      { pathname: "/f1/tracks/3d/singapore-preview.webp" },
      { pathname: "/f1/tracks/3d/austin-preview.webp" },
      { pathname: "/f1/tracks/3d/mexico-preview.webp" },
      { pathname: "/f1/tracks/3d/monaco-preview.webp" },
      { pathname: "/f1/tracks/3d/suzuka-preview.webp" },
      { pathname: "/f1/tracks/3d/interlagos-preview.webp" },
      { pathname: "/f1/tracks/3d/las-vegas-preview.webp" },
      { pathname: "/f1/tracks/3d/shanghai-preview.webp" },
      { pathname: "/f1/tracks/3d/albert-park-preview.webp" },
      { pathname: "/f1/tracks/3d/qatar-preview.webp" },
      { pathname: "/f1/tracks/3d/yas-marina-preview.webp" },
    ],
    remotePatterns: [
      {
        protocol: "https",
        hostname: "**",
      },
    ],
  },
  experimental: {
    cpus: 1,
  },
  output: "standalone",
};

const hasSentrySourceMapUpload = Boolean(
  process.env.SENTRY_AUTH_TOKEN &&
  process.env.SENTRY_ORG &&
  process.env.SENTRY_PROJECT,
);

export default withSentryConfig(nextConfig, {
  authToken: process.env.SENTRY_AUTH_TOKEN,
  org: process.env.SENTRY_ORG,
  project: process.env.SENTRY_PROJECT,
  release: {
    name: resolveSentryRelease(),
  },
  silent: !process.env.CI,
  sourcemaps: {
    disable: !hasSentrySourceMapUpload,
  },
  telemetry: false,
  webpack: {
    treeshake: {
      removeDebugLogging: true,
    },
  },
});
