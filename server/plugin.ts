import type { IncomingMessage } from "node:http";
import type { Plugin } from "vite";
import { BadBody, handleApi } from "./api.ts";

function readBody(req: IncomingMessage): Promise<Record<string, unknown>> {
  return new Promise((done, fail) => {
    let raw = "";
    req.on("data", (c) => (raw += c));
    req.on("error", fail);
    req.on("end", () => {
      try {
        done(raw ? JSON.parse(raw) : {});
      } catch {
        fail(new BadBody("The request body isn't valid JSON"));
      }
    });
  });
}

/** Serves server/api.ts on the dev server. Cloudflare Pages serves the same handler from functions/api/[[path]].ts. */
export function intentApi(): Plugin {
  return {
    name: "suave-intent-api",
    configureServer(server) {
      server.middlewares.use("/api", (req, res) => {
        // An error thrown in an async route would otherwise be unhandled and stop the dev server.
        handleApi(`/api${req.url?.split("?")[0] ?? ""}`, req.method ?? "GET", () => readBody(req))
          .catch((err) => ({ status: err instanceof BadBody ? 400 : 500, body: { error: err instanceof Error ? err.message : String(err) } }))
          .then(({ status, body }) => {
            res.statusCode = status;
            res.setHeader("Content-Type", "application/json");
            res.end(JSON.stringify(body));
          });
      });
    },
  };
}
