import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import { defineConfig, loadEnv } from "vite";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";
import { RETRIEVAL } from "./server/api";
import { intentApi } from "./server/plugin";

// suave runs at https://suave.localhost via portless.
const REPO_ENV = resolve(__dirname, ".env.local");

export default defineConfig(({ mode }) => {
  Object.assign(process.env, loadEnv(mode, process.cwd(), ""));
  for (const name of ["TYPESAFE_API_KEY", "GEMINI_API_KEY"]) {
    if (process.env[name] || !existsSync(REPO_ENV)) continue;
    const line = readFileSync(REPO_ENV, "utf8").match(new RegExp(`^${name}=(.+)$`, "m"));
    if (line) process.env[name] = line[1].trim().replace(/^["']|["']$/g, "");
  }
  return {
    plugins: [react(), tailwindcss(), intentApi()],
    worker: { format: "es" },
    // Transformers.js ships prebuilt ESM with its own wasm loader; pre-bundling breaks its asset URLs.
    optimizeDeps: { exclude: ["@huggingface/transformers"] },
    server: {
      host: "127.0.0.1",
      port: Number(process.env.PORT) || 5187,
      strictPort: true,
      allowedHosts: [".localhost"],
      // Label saves write eval/*.json; watching them reloads the page mid-review.
      watch: { ignored: ["**/eval/**"] },
      proxy: {
        "/retrieval": { target: RETRIEVAL, rewrite: (p) => p.replace(/^\/retrieval/, "") },
      },
    },
  };
});
