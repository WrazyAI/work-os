import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "Work OS",
  description: "Work OS — daily work sessions, plans, and evidence.",
};

export default function RootLayout({
  children,
}: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
