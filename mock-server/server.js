// Minimal mock server for RemoteWork Desktop demo
// Usage:         node server.js
// Offline mode:  node server.js --offline
// Requires Node.js 18+. No npm install needed (uses built-in http module).

const http = require("http");

const PORT = 3000;
const OFFLINE = process.argv.includes("--offline");

// --- Stub data ---
const ACCESS_TOKEN = "mock-access-token";
const DEVICE_ID = "mock-device-001";
const SESSION_ID = () => `session-${Date.now()}`;

const RULES = {
  work: { targetMinutesPerDay: 600, overtimePromptEnabled: true },
  idle: {
    idleThresholdSeconds: 30, // short threshold so idle is easy to trigger in demo
    popupTimeoutSeconds: 15,
    autoPauseEnabled: true,
    reasonRequired: true,
  },
  idleReasons: [
    { code: "meeting", label: "Meeting" },
    { code: "phone",   label: "Phone" },
    { code: "away",    label: "Away from computer" },
    { code: "learning",label: "Learning" },
    { code: "other",   label: "Other" },
  ],
};

// Toggle offline mode at runtime via POST /mock/offline and POST /mock/online
let offline = OFFLINE;

// --- Logging ---
function ts() {
  return new Date().toTimeString().slice(0, 8);
}

function log(method, path, status, detail = "") {
  const detail_ = detail ? `  ${detail}` : "";
  console.log(`[${ts()}] ${method.padEnd(4)} ${path.padEnd(35)} -> ${status}${detail_}`);
}

// --- Router ---
function route(method, path, body, res) {

  // Runtime offline toggle (always available regardless of offline flag)
  if (method === "POST" && path === "/mock/offline") {
    offline = true;
    console.log(`[${ts()}] --- Offline mode ON ---`);
    return json(res, 200, { offline: true });
  }
  if (method === "POST" && path === "/mock/online") {
    offline = false;
    console.log(`[${ts()}] --- Offline mode OFF ---`);
    return json(res, 200, { offline: false });
  }

  // Simulate server being unreachable
  if (offline) {
    log(method, path, "503 (offline mode)");
    return json(res, 503, { error: "Server offline (mock)" });
  }

  if (method === "POST" && path === "/auth/login") {
    log(method, path, "200", `email=${body.email ?? "?"}`);
    return json(res, 200, {
      accessToken: ACCESS_TOKEN,
      refreshToken: "mock-refresh-token",
      user: {
        id: "user-001",
        organizationId: "org-001",
        email: body.email ?? "employee@example.com",
        name: "Demo User",
        roles: ["employee"],
      },
    });
  }

  if (method === "POST" && path === "/desktop/devices/register") {
    log(method, path, "200", `device=${body.deviceName ?? "?"}`);
    return json(res, 200, {
      id: DEVICE_ID,
      deviceName: body.deviceName ?? "DEMO-PC",
      platform: "windows",
      appVersion: body.appVersion ?? "0.1.0",
    });
  }

  if (method === "GET" && path === "/desktop/rules") {
    log(method, path, "200");
    return json(res, 200, RULES);
  }

  if (method === "POST" && path === "/desktop/work/start") {
    const id = SESSION_ID();
    log(method, path, "200", `sessionId=${id}`);
    return json(res, 200, {
      id,
      userId: "user-001",
      projectId: body.projectId ?? null,
      startedAt: new Date().toISOString(),
      endedAt: null,
      status: "active",
    });
  }

  if (method === "POST" && path === "/desktop/work/pause") {
    log(method, path, "204");
    return empty(res, 204);
  }

  if (method === "POST" && path === "/desktop/work/resume") {
    log(method, path, "204");
    return empty(res, 204);
  }

  if (method === "POST" && path === "/desktop/work/stop") {
    log(method, path, "204");
    return empty(res, 204);
  }

  if (method === "POST" && path === "/desktop/idle-records") {
    const reason = body.reasonCode ?? "unknown";
    const dur = body.idleStartedAt && body.idleEndedAt
      ? `${Math.round((new Date(body.idleEndedAt) - new Date(body.idleStartedAt)) / 1000)}s idle`
      : "";
    log(method, path, "204", `reason=${reason}${dur ? "  " + dur : ""}`);
    return empty(res, 204);
  }

  if (method === "POST" && path === "/desktop/events/sync") {
    const events = body.events ?? [];
    const types = events.map(ev => ev.EventType ?? ev.eventType ?? "?").join(", ");
    log(method, path, "200", `${events.length} event(s): ${types || "none"}`);
    return json(res, 200, { synced: events.length });
  }

  if (method === "POST" && path === "/desktop/daily-reports") {
    log(method, path, "204", `date=${body.workDate ?? "?"}`);
    return empty(res, 204);
  }

  log(method, path, "404");
  return json(res, 404, { error: "Not found" });
}

// --- Helpers ---
function json(res, status, body) {
  const payload = JSON.stringify(body);
  res.writeHead(status, {
    "Content-Type": "application/json",
    "Content-Length": Buffer.byteLength(payload),
  });
  res.end(payload);
}

function empty(res, status) {
  res.writeHead(status);
  res.end();
}

function stripQuery(url) {
  const q = url.indexOf("?");
  return q === -1 ? url : url.slice(0, q);
}

// --- Server ---
const server = http.createServer((req, res) => {
  let raw = "";
  req.on("data", (chunk) => (raw += chunk));
  req.on("end", () => {
    let body = {};
    try { body = raw ? JSON.parse(raw) : {}; } catch (_) {}
    route(req.method, stripQuery(req.url), body, res);
  });
});

server.listen(PORT, "127.0.0.1", () => {
  console.log(`\nMock API  http://localhost:${PORT}`);
  console.log(`Mode      ${offline ? "OFFLINE (start with --offline)" : "online"}`);
  console.log(`Idle threshold  30s  |  popup timeout  15s`);
  console.log();
  console.log("Toggle offline at runtime:");
  console.log(`  curl -X POST http://localhost:${PORT}/mock/offline`);
  console.log(`  curl -X POST http://localhost:${PORT}/mock/online`);
  console.log();
});
