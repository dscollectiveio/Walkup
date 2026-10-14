import type { MetadataRoute } from "next";

export default function manifest(): MetadataRoute.Manifest {
  return {
    name: "Walkup",
    short_name: "Walkup",
    description: "Books, dues and taxes for self-managed condo associations.",
    start_url: "/",
    display: "standalone",
    background_color: "#F5EFE3",
    theme_color: "#1B2A41",
    icons: [
      { src: "/icon-192.png", sizes: "192x192", type: "image/png" },
      { src: "/icon-512.png", sizes: "512x512", type: "image/png" },
    ],
  };
}
