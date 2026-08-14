import type { Metadata } from "next";
import { Geist, Geist_Mono } from "next/font/google";
import { headers } from "next/headers";
import "./globals.css";

const geistSans = Geist({
  variable: "--font-geist-sans",
  subsets: ["latin"],
});

const geistMono = Geist_Mono({
  variable: "--font-geist-mono",
  subsets: ["latin"],
});

export async function generateMetadata(): Promise<Metadata> {
  const requestHeaders = await headers();
  const host =
    requestHeaders.get("x-forwarded-host") ??
    requestHeaders.get("host") ??
    "localhost:3000";
  const protocol = requestHeaders.get("x-forwarded-proto") ?? "https";
  const metadataBase = new URL(`${protocol}://${host}`);

  return {
    metadataBase,
    title: "Arbitra Research Platform",
    description:
      "Evidence-led market signals and resumable historical market-data acquisition for Arbitra research.",
    openGraph: {
      title: "Arbitra Research Platform",
      description: "Research signals, immutable market-data evidence, and downloadable historical acquisitions.",
      images: [{ url: "/og-data-acquisition-v1.png", width: 1672, height: 941 }],
    },
    twitter: {
      card: "summary_large_image",
      title: "Arbitra Research Platform",
      description: "Research signals, immutable market-data evidence, and downloadable historical acquisitions.",
      images: ["/og-data-acquisition-v1.png"],
    },
  };
}

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en">
      <body
        className={`${geistSans.variable} ${geistMono.variable} antialiased`}
      >
        {children}
      </body>
    </html>
  );
}
