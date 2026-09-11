import type { CSSProperties } from "react";
import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "Work OS",
  description: "Work OS — daily work sessions, plans, and evidence.",
};

// globals.css reads --font-inter / --font-jetbrains-mono. The desktop build
// injects them through next/font; the web build has no self-hosted font files,
// so define resilient system stacks. Without these, the variables are
// undefined and CSS invalidates the whole font-family declaration (serif).
const fontVariables = {
  "--font-inter": "Inter, 'Segoe UI Variable Text', 'Segoe UI', system-ui, sans-serif",
  "--font-jetbrains-mono": "ui-monospace, SFMono-Regular, Menlo, Consolas, monospace",
} as CSSProperties;

export default function RootLayout({
  children,
}: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="en" style={fontVariables}>
      <body>{children}</body>
    </html>
  );
}
