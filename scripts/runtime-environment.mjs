// Detect whether this process is running on Railway or on a developer machine.
//
// Mirrors arbitra_runtime_environment.py in the Arbitra repository so both
// sides of the platform apply the same rule. Endpoint guards are fail-closed on
// Railway; off Railway a loopback destination is additionally allowed so the
// real code path can run locally without a weaker rule ever reaching a deployed
// service.
//
// Detection is positive: absence of every marker means local. A deployed
// service that somehow lost its markers is therefore treated as local, which
// widens what it may reach only as far as its own loopback interface, never to
// a public host.

export const RAILWAY_MARKERS = Object.freeze([
  "RAILWAY_ENVIRONMENT",
  "RAILWAY_ENVIRONMENT_NAME",
  "RAILWAY_PROJECT_ID",
  "RAILWAY_SERVICE_ID",
  "RAILWAY_DEPLOYMENT_ID",
]);

export const LOOPBACK_HOSTS = Object.freeze(
  new Set(["127.0.0.1", "localhost", "[::1]", "::1"]),
);

export function isRailwayRuntime(environment = process.env) {
  return RAILWAY_MARKERS.some((name) => String(environment[name] ?? "").trim() !== "");
}

export function loopbackAllowed(environment = process.env) {
  return !isRailwayRuntime(environment);
}
