// The long-lived Node launcher owns the scheduler and intercepts this route.
// Workers/build previews cannot provide an unattended, shared market scan.
export async function GET() {
  return Response.json({ status: "unavailable", reason: "The shared market scan requires the Node runtime (npm start)." }, { status: 503, headers: { "cache-control": "no-store" } });
}
