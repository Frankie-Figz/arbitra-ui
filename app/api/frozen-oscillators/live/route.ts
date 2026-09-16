import { createFrozenOscillatorHandler } from "../../../../scripts/frozen-oscillator-proxy.mjs";

export async function GET(request: Request) {
  try {
    const handler = createFrozenOscillatorHandler({
      serviceUrl: process.env.ARBITRA_OSCILLATOR_SERVICE_URL ?? "",
      token: process.env.ARBITRA_OSCILLATOR_SERVICE_TOKEN ?? "",
    });
    return (await handler(request)) ?? new Response(null, { status: 404 });
  } catch {
    return Response.json({ status: "unavailable", reason: "Live service configuration is invalid", results: [] }, { status: 503 });
  }
}
