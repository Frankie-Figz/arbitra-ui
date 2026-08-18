import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { mkdtemp, rm } from "node:fs/promises";
import net from "node:net";
import os from "node:os";
import path from "node:path";
import test from "node:test";

const root = new URL("../", import.meta.url);

async function unusedPort() {
  const server = net.createServer();
  await new Promise((resolve, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", resolve);
  });
  const address = server.address();
  const port = typeof address === "object" && address ? address.port : 0;
  await new Promise((resolve, reject) => server.close((error) => error ? reject(error) : resolve()));
  return port;
}

async function waitForPage(url, child) {
  for (let attempt = 0; attempt < 40; attempt += 1) {
    if (child.exitCode !== null) throw new Error(`platform exited with ${child.exitCode}`);
    try {
      const response = await fetch(url);
      if (response.ok) return response;
    } catch {
      // The production launcher may still be importing the built server.
    }
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
  throw new Error("platform HTTP smoke did not become ready");
}

function eligibleRange(now = new Date()) {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: "America/New_York",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(now);
  const values = Object.fromEntries(parts.map((part) => [part.type, part.value]));
  const today = new Date(`${values.year}-${values.month}-${values.day}T00:00:00Z`);
  const rangeStart = new Date(today);
  rangeStart.setUTCFullYear(rangeStart.getUTCFullYear() - 2);
  const rangeEnd = new Date(today);
  rangeEnd.setUTCDate(rangeEnd.getUTCDate() - 1);
  return {
    rangeStart: rangeStart.toISOString().slice(0, 10),
    rangeEnd: rangeEnd.toISOString().slice(0, 10),
  };
}

test("production launcher serves the UI and private job lifecycle over HTTP", async (context) => {
  const directory = await mkdtemp(path.join(os.tmpdir(), "arbitra-platform-http-"));
  const port = await unusedPort();
  const child = spawn(
    process.execPath,
    ["scripts/start-local.mjs", "--hostname", "127.0.0.1", "--port", String(port)],
    {
      cwd: root,
      env: {
        ...process.env,
        ARBITRA_DATA_JOBS_ROOT: directory,
        ARBITRA_PLATFORM_JOB_TOKEN: "test-http-admin",
        ARBITRA_DATA_WORKER_TOKEN: "test-http-worker",
      },
      stdio: "ignore",
      windowsHide: true,
    },
  );
  context.after(async () => {
    if (child.exitCode === null) child.kill();
    await rm(directory, { recursive: true, force: true });
  });

  const baseUrl = `http://127.0.0.1:${port}`;
  const page = await waitForPage(`${baseUrl}/`, child);
  const html = await page.text();
  assert.match(html, /Market Signals/);
  assert.doesNotMatch(html, /Historical data acquisition/);

  const createdResponse = await fetch(`${baseUrl}/api/data-jobs`, {
    method: "POST",
    headers: {
      authorization: "Bearer test-http-admin",
      "content-type": "application/json",
    },
    body: JSON.stringify({
      ...eligibleRange(),
      universe: { type: "top_weighted", limit: 1 },
    }),
  });
  assert.equal(createdResponse.status, 201);
  const created = (await createdResponse.json()).job;

  const claimResponse = await fetch(`${baseUrl}/internal/data-jobs/claim`, {
    method: "POST",
    headers: {
      authorization: "Bearer test-http-worker",
      "content-type": "application/json",
    },
    body: JSON.stringify({ workerId: "http-smoke" }),
  });
  assert.equal(claimResponse.status, 200);
  assert.equal((await claimResponse.json()).job.status, "running");

  const cancelResponse = await fetch(`${baseUrl}/api/data-jobs/${created.id}/cancel`, {
    method: "POST",
    headers: {
      authorization: "Bearer test-http-admin",
      "content-type": "application/json",
    },
    body: "{}",
  });
  assert.equal(cancelResponse.status, 200);
  assert.equal((await cancelResponse.json()).job.status, "cancel_requested");
});
