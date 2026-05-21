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
      <head>
        <script
          dangerouslySetInnerHTML={{
            __html: `(function(){try{var t=localStorage.getItem("escalapreco-theme");if(t==="dark"||(!t||t!=="light")&&window.matchMedia("(prefers-color-scheme: dark)").matches)document.documentElement.classList.add("dark");}catch(e){}})();`,
          }}
        />
      </head>
      <body className="min-h-screen antialiased" style={{ backgroundColor: "var(--body-bg)", color: "var(--body-text)" }}>
        <ThemeProvider>{children}</ThemeProvider>
      </body>
    </html>
  );
}
