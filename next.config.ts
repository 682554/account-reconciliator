import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  /* config options here */
  reactCompiler: true,
  // pdf-parse (via pdfjs-dist) loads its worker script from a real file path at
  // runtime; bundling it breaks that resolution, so let Node's own require/import
  // resolve it from node_modules instead.
  serverExternalPackages: ["pdf-parse", "pdfjs-dist"],
  // Vercel's deployment file-tracer only copies files it can statically see being
  // required — it misses pdfjs-dist's worker script and cmap/font data since those
  // are loaded via a runtime-computed path, not a literal import. Force-include the
  // whole packages so the worker actually exists in the deployed function.
  outputFileTracingIncludes: {
    "/api/parse/pdf": ["./node_modules/pdf-parse/**", "./node_modules/pdfjs-dist/**"],
  },
};

export default nextConfig;
