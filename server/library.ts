/** Library collection writes. Defaults to a local metadata API. */
const BASE = process.env.LIBRARY_URL ?? "http://127.0.0.1:8888";

export type NewCollection = { name: string; discoverable: boolean; assets: { id: string; name: string }[] };
export type CreatedCollection = { id: string; name: string; items: number };

async function send<T>(path: string, body: unknown): Promise<T> {
  const res = await fetch(`${BASE}${path}`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
  if (!res.ok) throw new Error(`Library ${path} answered ${res.status}`);
  return (await res.json()) as T;
}

export async function createCollection({ name, discoverable, assets }: NewCollection): Promise<CreatedCollection> {
  const collection = await send<{ id: string; name: string }>("/collections", {
    name,
    type: "Asset",
    workflow: "modeling",
    discoverable: discoverable ? "DISCOVERABLE" : "NOTDISCOVERABLE",
  });
  return { id: collection.id, name: collection.name, items: await addItems(collection.id, assets) };
}

export async function addItems(id: string, assets: NewCollection["assets"]): Promise<number> {
  const items = await send<unknown[]>(`/collections/${encodeURIComponent(id)}/items`, {
    collectionItemCreate: assets.map((a) => ({ assetId: a.id, name: a.name, type: "Asset" })),
  });
  return items.length;
}
