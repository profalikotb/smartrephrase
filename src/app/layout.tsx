import type { Metadata, Viewport } from "next";
import "@fontsource-variable/inter";
import "@fontsource/ibm-plex-sans-arabic/400.css";
import "@fontsource/ibm-plex-sans-arabic/500.css";
import "@fontsource/ibm-plex-sans-arabic/600.css";
import "./globals.css";

export const metadata: Metadata = {
  title: "Prof Ali Kotb — Smart Rephrase",
  description: "Bilingual Arabic & English rephrasing that preserves meaning, facts and clinical detail.",
  applicationName: "Smart Rephrase",
  appleWebApp: { capable: true, title: "Smart Rephrase", statusBarStyle: "default" },
  icons: { icon: [{ url: "/icon.svg", type: "image/svg+xml" }, { url: "/icon-192.png", sizes: "192x192" }], apple: "/apple-touch-icon.png" },
  robots: { index: false, follow: false },
  formatDetection: { telephone: false, date: false, email: false, address: false },
};

export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  viewportFit: "cover",
  interactiveWidget: "resizes-content",
  themeColor: [
    { media: "(prefers-color-scheme: light)", color: "#f4f6f5" },
    { media: "(prefers-color-scheme: dark)", color: "#0d1312" },
  ],
};

/** Runs before paint: applies saved theme + language direction to avoid a flash of the wrong layout. */
const BOOT = `(()=>{try{var p=JSON.parse(localStorage.getItem("sr:prefs:v1")||"{}");var l=p.uiLang==="en"||p.uiLang==="ar"?p.uiLang:((navigator.language||"").toLowerCase().indexOf("ar")===0?"ar":"en");var t=p.theme==="light"||p.theme==="dark"?p.theme:(matchMedia("(prefers-color-scheme: dark)").matches?"dark":"light");var d=document.documentElement;d.lang=l;d.dir=l==="ar"?"rtl":"ltr";d.dataset.theme=t;}catch(e){}})();`;

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="ar" dir="rtl" suppressHydrationWarning>
      <head>
        <script dangerouslySetInnerHTML={{ __html: BOOT }} />
      </head>
      <body>{children}</body>
    </html>
  );
}
