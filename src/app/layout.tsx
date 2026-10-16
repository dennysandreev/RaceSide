import type { Metadata, Viewport } from "next";
import { GeistMono } from "geist/font/mono";
import { GeistSans } from "geist/font/sans";
import Script from "next/script";

import { JsonLd } from "@/components/racemate/json-ld";
import {
  createPageMetadata,
  DEFAULT_SITE_DESCRIPTION,
  SITE_LANGUAGE,
  SITE_NAME,
  SITE_URL,
} from "@/lib/seo";

import "./globals.css";

export const metadata: Metadata = {
  ...createPageMetadata({
    description: DEFAULT_SITE_DESCRIPTION,
    path: "/",
    title: "RaceSide - Формула-1 на русском",
  }),
  applicationName: SITE_NAME,
  authors: [{ name: SITE_NAME, url: SITE_URL }],
  category: "sports",
  creator: SITE_NAME,
  formatDetection: {
    address: false,
    email: false,
    telephone: false,
  },
  metadataBase: new URL(SITE_URL),
  publisher: SITE_NAME,
};

export const viewport: Viewport = {
  colorScheme: "dark light",
  themeColor: [
    { color: "#0B0B0B", media: "(prefers-color-scheme: dark)" },
    { color: "#F4F4F5", media: "(prefers-color-scheme: light)" },
  ],
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="ru" data-scroll-behavior="smooth" suppressHydrationWarning>
      <head>
        <Script id="racemate-theme-init" strategy="beforeInteractive">
          {`try { document.documentElement.dataset.theme = localStorage.getItem('racemate-theme') === 'light' ? 'light' : 'dark'; } catch { document.documentElement.dataset.theme = 'dark'; }`}
        </Script>
      </head>
      <body className={`${GeistSans.variable} ${GeistMono.variable}`}>
        <JsonLd
          data={[
            {
              "@context": "https://schema.org",
              "@id": `${SITE_URL}/#organization`,
              "@type": "Organization",
              description: DEFAULT_SITE_DESCRIPTION,
              logo: {
                "@type": "ImageObject",
                height: 512,
                url: `${SITE_URL}/brand/raceside/avatar-trajectory-dark.png`,
                width: 512,
              },
              name: SITE_NAME,
              url: SITE_URL,
            },
            {
              "@context": "https://schema.org",
              "@id": `${SITE_URL}/#website`,
              "@type": "WebSite",
              alternateName: "RaceSide F1",
              description: DEFAULT_SITE_DESCRIPTION,
              inLanguage: SITE_LANGUAGE,
              name: SITE_NAME,
              publisher: {
                "@id": `${SITE_URL}/#organization`,
              },
              url: SITE_URL,
            },
          ]}
        />
        {children}
      </body>
    </html>
  );
}
