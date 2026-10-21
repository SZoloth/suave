/**
 * Reads each asset's published glTF from Poly Haven and records what the file holds: the top-level objects in its
 * scene, how many meshes, and any finish variants (KHR_materials_variants).
 * Writes embed/vision/files.json: { [assetId]: { description, objects: { name, vertices }[], meshes, variants: string[] } }.
 * Usage: node embed/asset-files.mjs
 */
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";

const INDEX = new URL("index/", import.meta.url);
const OUT = new URL("vision/files.json", import.meta.url);

async function json(url) {
  for (let attempt = 0; ; attempt++) {
    const res = await fetch(url);
    if (res.ok) return res.json();
    if (attempt >= 3) throw new Error(`${url} ${res.status}`);
    await new Promise((r) => setTimeout(r, 2000 * (attempt + 1)));
  }
}

async function inspect(id) {
  const files = await json(`https://api.polyhaven.com/files/${id}`);
  const url = files.gltf?.["1k"]?.gltf?.url ?? Object.values(files.gltf ?? {})[0]?.gltf?.url;
  if (!url) return null;
  const [g, info] = await Promise.all([json(url), json(`https://api.polyhaven.com/info/${id}`)]);
  const scene = g.scenes?.[g.scene ?? 0];
  const vertices = (n) => {
    const node = g.nodes[n];
    const own = node.mesh === undefined ? 0 : g.meshes[node.mesh].primitives.reduce((s, p) => s + (g.accessors[p.attributes.POSITION]?.count ?? 0), 0);
    return own + (node.children ?? []).reduce((s, c) => s + vertices(c), 0);
  };
  return {
    description: info.description ?? "",
    objects: (scene?.nodes ?? []).map((n) => ({ name: g.nodes[n].name ?? `node ${n}`, vertices: vertices(n) })),
    meshes: g.meshes?.length ?? 0,
    variants: (g.extensions?.KHR_materials_variants?.variants ?? []).map((v) => v.name),
  };
}

const assets = JSON.parse(readFileSync(new URL("assets.json", INDEX), "utf8"));
const out = {};
let next = 0;
await Promise.all(
  Array.from({ length: 8 }, async () => {
    while (next < assets.length) {
      const { id } = assets[next++];
      out[id] = await inspect(id).catch((e) => ({ error: String(e.message).slice(0, 120) }));
    }
  }),
);
mkdirSync(new URL(".", OUT), { recursive: true });
writeFileSync(OUT, JSON.stringify(Object.fromEntries(assets.map((a) => [a.id, out[a.id]])), null, 1));
const read = Object.values(out).filter((x) => x && !x.error);
console.log(`read ${read.length} of ${assets.length} files: ${read.filter((x) => x.objects.length > 1).length} hold more than one top-level object, ${read.filter((x) => x.variants.length).length} have finish variants`);
