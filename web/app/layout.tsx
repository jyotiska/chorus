import type { Metadata } from "next";
import { IBM_Plex_Mono, IBM_Plex_Sans } from "next/font/google";
import { HarnessSelectProvider } from "@/components/harness/select";
import "@xterm/xterm/css/xterm.css";
import "./globals.css";
import "./harness.css";

const plexSans = IBM_Plex_Sans({
  variable: "--font-plex-sans",
  weight: ["400", "500", "600"],
  subsets: ["latin"],
});

const plexMono = IBM_Plex_Mono({
  variable: "--font-plex-mono",
  weight: ["400", "500"],
  subsets: ["latin"],
});

export const metadata: Metadata = {
  title: "Chorus",
  description:
    "A shared workspace for multi-agent discussions and canvas deliverables.",
};

export default function RootLayout({ children }: LayoutProps<"/">) {
  return (
    <html
      lang="en"
      className={`dark ${plexSans.variable} ${plexMono.variable} h-full antialiased`}
    >
      <body className="min-h-full flex flex-col">
        <HarnessSelectProvider>{children}</HarnessSelectProvider>
      </body>
    </html>
  );
}
