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
    title: "Arbitra Market Signals",
    description:
      "Indicator-led stock trade setups, daily ETF Godmode/MFI opportunities, and hourly crypto RSI/EMA signals from completed candles.",
    openGraph: {
      title: "Arbitra Market Signals",
      description: "Daily indicator-led stock and ETF setups plus hourly crypto signals from completed candles.",
      images: [{ url: "/og-market-signals-etf-crypto.png", width: 1672, height: 941 }],
    },
    twitter: {
      card: "summary_large_image",
      title: "Arbitra Market Signals",
      description: "Daily indicator-led stock and ETF setups plus hourly crypto signals from completed candles.",
      images: ["/og-market-signals-etf-crypto.png"],
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
