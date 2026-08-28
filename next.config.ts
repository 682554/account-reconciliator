import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  /* config options here */
  reactCompiler: true,
  // pdf-parse (via pdfjs-dist) loads its worker script from a real file path at
  // runtime; bundling it breaks that resolution, so let Node's own require/import
  // resolve it from node_modules instead.
  // @napi-rs/canvas is a native (Rust/NAPI) binary — pdfjs-dist uses it in Node to
  // polyfill browser-only globals like DOMMatrix that its table/geometry detection
  // needs. Bundling native binaries breaks their loading, so keep it external too.
  serverExternalPackages: ["pdf-parse", "pdfjs-dist", "@napi-rs/canvas"],
  // Vercel's deployment file-tracer only copies files it can statically see being
  // required — it misses pdfjs-dist's worker script/cmap/font data and the whole
  // @napi-rs/canvas native binary, since those are loaded via a runtime-computed
  // path, not a literal import. Force-include the whole packages so they actually
  // exist in the deployed function.
  outputFileTracingIncludes: {
    "/api/parse/pdf": [
      "./node_modules/pdf-parse/**",
      "./node_modules/pdfjs-dist/**",
      "./node_modules/@napi-rs/**",
    ],
  },
};

export default nextConfig;
