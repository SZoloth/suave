import assert from "node:assert/strict";
import type { AddressInfo } from "node:net";
import { after, before, test } from "node:test";
import { type ViteDevServer, createServer } from "vite";

let server: ViteDevServer;
let base: string;

before(async () => {
  server = await createServer({ configFile: new URL("../vite.config.ts", import.meta.url).pathname, logLevel: "silent", server: { port: 0, strictPort: false } });
  await server.listen();
  base = `http://127.0.0.1:${(server.httpServer!.address() as AddressInfo).port}`;
});

after(() => server.close());

test("a malformed body gets a 400 and the server keeps serving", async () => {
  const bad = await fetch(`${base}/api/members`, { method: "POST", headers: { "Content-Type": "application/json" }, body: '{"search":"chairs","candidates":,}' });
  assert.equal(bad.status, 400);
  const status = await fetch(`${base}/api/status`);
  assert.equal(status.status, 200);
});
