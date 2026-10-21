import { BadBody, handleApi } from "../../server/api.ts";

export const onRequest = async ({ request }: { request: Request }) => {
  const body = async () => {
    const raw = await request.text();
    try {
      return raw ? (JSON.parse(raw) as Record<string, unknown>) : {};
    } catch {
      throw new BadBody("The request body isn't valid JSON");
    }
  };
  const { status, body: out } = await handleApi(new URL(request.url).pathname, request.method, body, { publicDemo: true }).catch((err) => ({
    status: err instanceof BadBody ? 400 : 500,
    body: { error: err instanceof Error ? err.message : String(err) },
  }));
  return Response.json(out, { status });
};
