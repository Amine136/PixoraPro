import type { Metadata } from "next";
import { Geist, Geist_Mono } from "next/font/google";
import { Toaster } from "sonner";
import "./globals.css";

const geistSans = Geist({
  variable: "--font-geist-sans",
  subsets: ["latin"],
});

const geistMono = Geist_Mono({
  variable: "--font-geist-mono",
  subsets: ["latin"],
});

export const metadata: Metadata = {
  title: "Pixora — Vibecraft Editor",
  description:
    "Browser-based image editor for the Vibecraft AI image platform.",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html
      lang="en"
      className={`${geistSans.variable} ${geistMono.variable} h-full antialiased`}
    >
      <body className="h-full overflow-hidden bg-[#09090b] text-zinc-200">
        {children}
        <Toaster
          theme="dark"
          position="bottom-right"
          toastOptions={{
            style: {
              background: "rgba(24, 24, 27, 0.9)",
              backdropFilter: "blur(12px)",
              border: "1px solid rgba(30, 41, 59, 0.6)",
              color: "#e4e4e7",
            },
          }}
        />
      </body>
    </html>
  );
}
