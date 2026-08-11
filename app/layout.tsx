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
    title: "Arbitra Daily Longs",
    description:
      "Completed daily long setups with Yahoo company profiles, causal pace gates, and forecast-versus-achieved pullback evidence.",
    openGraph: {
      title: "Arbitra Daily Longs",
      description: "Completed candles. Causal gates. Pullback / target evidence.",
      images: [{ url: "/og.png", width: 1731, height: 909 }],
    },
    twitter: {
      card: "summary_large_image",
      title: "Arbitra Daily Longs",
      description: "Completed candles. Causal gates. Pullback / target evidence.",
      images: ["/og.png"],
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
