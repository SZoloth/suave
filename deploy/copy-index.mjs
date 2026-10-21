// Copies the retrieval index into dist/retrieval/ so the browser worker and thumbnails load it as static files.
import { cpSync, existsSync, readdirSync, rmSync } from "node:fs";

// Transformers.js loads ONNX Runtime's WASM from jsDelivr, so Vite's copy is never fetched, and at 25.6 MiB it's over Cloudflare Pages' 25 MiB file limit.
const assets = new URL("../dist/assets/", import.meta.url);
for (const file of readdirSync(assets)) if (file.endsWith(".wasm")) rmSync(new URL(file, assets));

const from = new URL("../embed/index/", import.meta.url);
const to = new URL("../dist/retrieval/", import.meta.url);
for (const file of ["assets.json", "metadata.json", "grouped.json", "collections.json", "english.json", "fused.npy", "text.npy", "image.npy"])
  if (!existsSync(new URL(file, from))) throw new Error(`embed/index/${file} is missing. Run npm run embed:index and embed/export_static.py.`);
rmSync(to, { recursive: true, force: true });
cpSync(from, to, { recursive: true, filter: (src) => !src.endsWith("parity.json") });
console.log("copied embed/index to dist/retrieval");
