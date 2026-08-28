import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  /* config options here */
  reactCompiler: true,
  // pdf-parse (via pdfjs-dist) loads its worker script from a real file path at
  // runtime; bundling it breaks that resolution, so let Node's own require/import
  // resolve it from node_modules instead.
  serverExternalPackages: ["pdf-parse", "pdfjs-dist"],
};

export default nextConfig;
