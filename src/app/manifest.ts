import type { MetadataRoute } from "next";

export const dynamic = "force-static";

export default function manifest(): MetadataRoute.Manifest {
  return {
    name: "Prof Ali Kotb — Smart Rephrase",
    short_name: "Rephrase",
    description: "Bilingual Arabic & English rephrasing that preserves meaning.",
    start_url: "/",
    scope: "/",
    display: "standalone",
    background_color: "#f4f6f5",
    theme_color: "#0d7a6f",
    dir: "auto",
    icons: [
      { src: "/icon-192.png", sizes: "192x192", type: "image/png" },
      { src: "/icon-512.png", sizes: "512x512", type: "image/png" },
      { src: "/icon-maskable-512.png", sizes: "512x512", type: "image/png", purpose: "maskable" },
    ],
  };
}
