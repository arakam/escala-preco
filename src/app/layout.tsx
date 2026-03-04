import type { Metadata } from "next";
import "./globals.css";
import { ThemeProvider } from "@/components/theme-provider";

export const metadata: Metadata = {
  title: "EscalaPreço",
  description: "MVP Integração Mercado Livre",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="pt-BR" suppressHydrationWarning>
      <body className="min-h-screen antialiased" style={{ backgroundColor: "var(--body-bg)", color: "var(--body-text)" }}>
        <ThemeProvider>{children}</ThemeProvider>
      </body>
    </html>
  );
}
