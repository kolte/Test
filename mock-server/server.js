// Minimal mock server for RemoteWork Desktop demo
// Usage: node server.js
// Requires Node.js 18+. No npm install needed (uses built-in http module).

const http = require("http");

const PORT = 3000;

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
    { code: "phone", label: "Phone" },
    { code: "away", label: "Away from computer" },
    { code: "learning", label: "Learning" },
    { code: "other", label: "Other" },
  ],
};

// --- Router ---
function route(method, path, body, res) {
  const log = `[${method}] ${path}`;

  if (method === "POST" && path === "/auth/login") {
    console.log(`${log} -> 200 OK`);
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
    console.log(`${log} -> 200 OK`);
    return json(res, 200, {
      id: DEVICE_ID,
      deviceName: body.deviceName ?? "DEMO-PC",
      platform: "windows",
      appVersion: body.appVersion ?? "0.1.0",
    });
  }

  if (method === "GET" && path === "/desktop/rules") {
    console.log(`${log} -> 200 OK`);
    return json(res, 200, RULES);
  }

  if (method === "POST" && path === "/desktop/work/start") {
    const id = SESSION_ID();
    console.log(`${log} -> 200 OK  sessionId=${id}`);
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
    console.log(`${log} -> 204 No Content`);
    return empty(res, 204);
  }

  if (method === "POST" && path === "/desktop/work/resume") {
    console.log(`${log} -> 204 No Content`);
    return empty(res, 204);
  }

  if (method === "POST" && path === "/desktop/work/stop") {
    console.log(`${log} -> 204 No Content`);
    return empty(res, 204);
  }

  if (method === "POST" && path === "/desktop/idle-records") {
    console.log(`${log} -> 204 No Content  reason=${body.reasonCode}`);
    return empty(res, 204);
  }

  if (method === "POST" && path === "/desktop/events/sync") {
    const count = body.events?.length ?? 0;
    console.log(`${log} -> 200 OK  synced ${count} event(s)`);
    return json(res, 200, { synced: count });
  }

  if (method === "POST" && path === "/desktop/daily-reports") {
    console.log(`${log} -> 204 No Content`);
    return empty(res, 204);
  }

  console.log(`${log} -> 404 Not Found`);
  return json(res, 404, { error: "Not found" });
}

// --- Helpers ---
function json(res, status, body) {
  const payload = JSON.stringify(body);
  res.writeHead(status, { "Content-Type": "application/json", "Content-Length": Buffer.byteLength(payload) });
  res.end(payload);
}

function empty(res, status) {
  res.writeHead(status);
  res.end();
}

// --- Server ---
const server = http.createServer((req, res) => {
  let raw = "";
  req.on("data", (chunk) => (raw += chunk));
  req.on("end", () => {
    let body = {};
    try { body = raw ? JSON.parse(raw) : {}; } catch (_) {}
    route(req.method, req.url, body, res);
  });
});

server.listen(PORT, "127.0.0.1", () => {
  console.log(`\nMock API server running at http://localhost:${PORT}`);
  console.log("NOTE: idleThresholdSeconds is set to 30s for easy demo triggering.\n");
});
