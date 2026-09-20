import type { Metadata } from "next";
import { Analytics } from "@vercel/analytics/next";
import "./globals.css";

export const metadata: Metadata = {
  title: "Trickshot · Musebook",
  description:
    "Rebuild any Solana token from the chain and play back what any wallet did on it — on Musebook.",
};

export default function RootLayout({
  children,
}: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="en">
      <body>
        <header
          style={{
            borderBottom: "1px solid var(--color-line)",
            background: "var(--color-ink-800)",
          }}
        >
          <div
            className="mx-auto flex w-full max-w-[1200px] items-center gap-3 px-4 py-2.5 sm:px-6"
            style={{ color: "var(--color-tx2)", fontSize: 13 }}
          >
            <a
              href="https://musebook.trade/"
              style={{
                color: "var(--color-tx)",
                fontWeight: 700,
                textDecoration: "none",
                display: "inline-flex",
                alignItems: "center",
                gap: 6,
              }}
            >
              <span aria-hidden>🦞</span> Musebook
            </a>
            <span aria-hidden style={{ color: "var(--color-tx3)" }}>
              /
            </span>
            <span style={{ color: "var(--color-tx)" }}>Trickshot</span>
            <span
              aria-hidden
              style={{
                marginLeft: "auto",
                height: 3,
                width: 72,
                borderRadius: 2,
                background: "linear-gradient(90deg, #9945FF, #14F195)",
              }}
            />
          </div>
        </header>
        <main className="mx-auto w-full max-w-[1200px] px-4 sm:px-6">
          {children}
        </main>
        <Analytics />
      </body>
    </html>
  );
}
