# RemoteWork Timekeeper — Backend

NestJS + Prisma + PostgreSQL REST API that powers the RemoteWork Timekeeper desktop client.

---

## Setup

```bash
cd backend
npm install
cp .env.example .env
```

Edit `.env` and set `DATABASE_URL` to point at your PostgreSQL instance:

```
DATABASE_URL="postgresql://postgres:<password>@localhost:5432/remotework?schema=public"
JWT_ACCESS_SECRET="your-access-secret"
JWT_REFRESH_SECRET="your-refresh-secret"
PORT=3000
```

Apply migrations and start the server:

```bash
npx prisma db push        # first time — syncs schema to a fresh database
npm run start:dev         # starts on http://localhost:3000
```

> For subsequent schema changes use `npx prisma migrate dev` instead of `db push`.

To create a test user (no registration endpoint exists):

```bash
node scripts/create-test-user.js employee@example.com password123 "Test Employee"
```

Run the test suite:

```bash
npm test
```

---

## API Endpoints

All endpoints are prefixed with the base URL (default `http://localhost:3000`).

Endpoints marked **🔒 Auth required** expect an `Authorization: Bearer <accessToken>` header.

### Auth

| Method | Path | Description |
|--------|------|-------------|
| POST | `/auth/login` | Sign in with email and password. Returns `accessToken`, `refreshToken`, and user profile. |
| POST | `/auth/refresh` | Exchange a refresh token for a fresh token pair. Refresh tokens rotate on every use. |
| GET | `/auth/me` 🔒 | Returns the signed-in user's profile. |

### Devices

| Method | Path | Description |
|--------|------|-------------|
| POST | `/desktop/devices/register` 🔒 | Registers or re-registers this device. Safe to call on every sign-in — re-registration updates the existing record rather than creating a duplicate. |

### Rules

| Method | Path | Description |
|--------|------|-------------|
| GET | `/desktop/rules` 🔒 | Returns the org-wide work and idle policy: daily target hours, idle detection threshold, auto-pause threshold, and the list of idle reason codes. |

### Work Actions

Live endpoints for when the client is online. All return `204 No Content` except `start`.

| Method | Path | Description |
|--------|------|-------------|
| POST | `/desktop/work/start` 🔒 | Starts a new work session. Returns the created session object (200). Idempotent on `clientSessionId` — retrying the same request returns the existing session. |
| POST | `/desktop/work/pause` 🔒 | Pauses the active session. |
| POST | `/desktop/work/resume` 🔒 | Resumes a paused session. |
| POST | `/desktop/work/stop` 🔒 | Ends the active session. |

### Idle Records

| Method | Path | Description |
|--------|------|-------------|
| POST | `/desktop/idle-records` 🔒 | Records an idle interval for an active session (start time, end time, reason). Returns 204. |

### Daily Reports

| Method | Path | Description |
|--------|------|-------------|
| POST | `/desktop/daily-reports` 🔒 | Submits or updates the user's daily report for a given date. Upserted on `(userId, workDate)` — resubmitting replaces the existing entry. Returns 204. |

### Today Summary

| Method | Path | Description |
|--------|------|-------------|
| GET | `/desktop/today-summary` 🔒 | Returns today's rolled-up stats: worked time (ms), idle time (ms), session count, daily report submission status, and the UTC work date. Updated automatically after every sync. |

### Sync

| Method | Path | Description |
|--------|------|-------------|
| POST | `/desktop/events/sync` | Submits a batch of offline-cached events. Fully idempotent — replaying the same `batchId` or the same individual `clientEventId` values is a safe no-op. Returns counts of accepted/skipped events and session mappings for any offline-started sessions. |

> The sync endpoint does not require an `Authorization` header — it authenticates implicitly via the `deviceId` field in the request body.

---

## Error Responses

All errors — including validation failures — return a consistent shape:

```json
{
  "statusCode": 400,
  "code": "VALIDATION_ERROR",
  "message": "deviceId must be a UUID; batchId must be a UUID"
}
```

Common error codes: `INVALID_CREDENTIALS`, `MISSING_ACCESS_TOKEN`, `INVALID_ACCESS_TOKEN`, `WORK_SESSION_NOT_FOUND`, `DEVICE_NOT_FOUND`, `VALIDATION_ERROR`, `ACTION_MISSING_SESSION_REFERENCE`.

---

## Testing with Postman

A ready-to-import collection is included: **`RemoteWork-API.postman_collection.json`** (one level up from this folder).

### Import the collection

1. Open Postman → **Import** → select `RemoteWork-API.postman_collection.json`.
2. The collection variable `baseUrl` defaults to `http://localhost:3000`. Change it under **Variables** if your server runs elsewhere.

### Recommended run order

Follow these steps in order — each one saves variables that the next request uses automatically.

**Step 1 — Login**

Send the **Auth → Login** request. The test script saves `accessToken`, `refreshToken`, and `userId` as collection variables. Update the email/password in the body to match your test user.

**Step 2 — Register Device**

Send **Devices → Register Device**. The test script saves `deviceId`.

**Step 3 — Get Rules** *(optional)*

Send **Rules → Get Rules** to confirm the idle reason codes your client will use.

**Step 4 — Start Work**

Send **Work Actions → Start Work**. The pre-request script mints a fresh `clientSessionId`; the test script saves the returned `sessionId`. Both are used by subsequent requests automatically.

**Step 5 — Pause / Resume / Stop**

Send these in order. Each uses `{{sessionId}}` and `{{clientSessionId}}` from Step 4.

**Step 6 — Submit Daily Report**

Send **Daily Reports → Submit Daily Report**. Update `workDate` to today's date in `yyyy-MM-dd` format.

**Step 7 — Get Today Summary**

Send **Today Summary → Get Today Summary** to verify worked time and report status reflect the session you just ran.

**Step 8 — Sync Offline Events** *(idempotency testing)*

Send **Sync → Sync Offline Events** once — note the `accepted` count in the response. Send it again with the same `batchId` — the response should return `"duplicateBatch": true` with the original counts unchanged. Change just the `batchId` but keep the same `clientEventId` values — the events should now appear in `skipped` instead of `accepted`.

### Token refresh

If requests start returning `401 INVALID_ACCESS_TOKEN` (access tokens expire after 15 minutes), send **Auth → Refresh Token**. The test script updates `accessToken` and `refreshToken` automatically.

---

## Project Layout

```
backend/
  prisma/
    schema.prisma           # All models: User, Device, WorkSession, WorkEvent,
                            # IdleRecord, DailyReport, WorkDay, SyncBatch
    migrations/             # SQL migration files
  scripts/
    create-test-user.js     # Helper to seed a login-able user
  src/
    main.ts                 # App bootstrap
    auth/                   # Login, refresh, JWT guard, password hashing
    desktop/                # Device registration, rules, work actions,
                            # idle records, daily reports, today summary
    sync/                   # Offline event batch processing
    common/                 # Global error response filter
    integration/            # Full-stack HTTP tests (cross-user isolation)
```
