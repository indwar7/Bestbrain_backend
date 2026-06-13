# EduLearn Backend

REST + WebSocket API for the [EduLearn](https://edulearn-platform-theta.vercel.app) learning platform —
auth with refresh tokens, role-based access, offline progress sync, PAL AI chat, and live classes.

Built with **Node.js + Express + TypeScript + MongoDB + Socket.IO**.

## Tech Stack

| Layer | Tool |
|-------|------|
| Runtime | Node.js 20 |
| Framework | Express 5 |
| Realtime | Socket.IO |
| Language | TypeScript |
| Database | MongoDB (Mongoose) |
| Auth | JWT (access + refresh) + bcrypt |

## Getting Started

```bash
npm install
cp .env.example .env      # fill in MONGODB_URI + the two JWT secrets
npm run dev               # dev with auto-reload (http://localhost:4000)

npm run build && npm start  # production
```

## Auth model

Two tokens:
- **Access token** — short-lived (15 min), returned in the JSON body, sent as `Authorization: Bearer <token>`.
- **Refresh token** — long-lived (7 days), stored in an **httpOnly cookie**, rotated on every `/auth/refresh`.

On app load, the frontend calls **`GET /api/auth/me`** to hydrate the session.
When the access token expires, call **`POST /api/auth/refresh`** to get a new one.

## API Endpoints

### Auth
| Method | Route | Auth | Description |
|--------|-------|------|-------------|
| POST | `/api/auth/signup` | – | `{ name, email, password, role? }` → access token + sets refresh cookie |
| POST | `/api/auth/login` | – | `{ email, password }` → access token + sets refresh cookie |
| POST | `/api/auth/refresh` | cookie | New access token (rotates refresh cookie) |
| POST | `/api/auth/logout` | – | Clears refresh cookie |
| GET  | `/api/auth/me` | ✅ | Hydrate current user session |

### Progress
| Method | Route | Auth | Description |
|--------|-------|------|-------------|
| GET  | `/api/progress` | ✅ | Current progress snapshot |
| PUT  | `/api/progress` | ✅ | Merge a progress snapshot |
| POST | `/api/progress/sync` | ✅ | **Batched offline events**, merged chronologically + idempotent |

`/progress/sync` body:
```json
{
  "events": [
    { "clientEventId": "uuid-1", "type": "lesson_watched", "payload": { "minutes": 12 }, "occurredAt": "2026-06-13T10:00:00Z" },
    { "clientEventId": "uuid-2", "type": "streak_tick", "occurredAt": "2026-06-13T10:05:00Z" }
  ]
}
```
Re-sending the same `clientEventId` is safe — already-applied events are skipped.

### PAL AI
| Method | Route | Auth | Description |
|--------|-------|------|-------------|
| POST | `/api/pal/chat` | ✅ | `{ role, message, sessionId? }` → `{ sessionId, reply }`. History stored per session in DB. |
| GET  | `/api/pal/sessions/:id` | ✅ | Full conversation history |

Set `GROQ_API_KEY` for real LLM replies; otherwise returns a stub so the flow works in dev.

### Live classes (REST)
| Method | Route | Auth | Description |
|--------|-------|------|-------------|
| GET  | `/api/live` | ✅ | List active sessions |
| POST | `/api/live` | ✅ teacher | Create a live session |
| POST | `/api/live/:id/end` | ✅ teacher | End a session |

Teacher-only routes use the `requireRole("teacher")` middleware.

### Live classes (Socket.IO)
Connect with the access token on the handshake:
```js
const socket = io(API_URL, { auth: { token: accessToken } });
```
Events:
| Event | Direction | Payload |
|-------|-----------|---------|
| `join-session` | client → server | `{ sessionId }` |
| `leave-session` | client → server | `{ sessionId }` |
| `attention-ping` | client → server | `{ sessionId, score }` (from webcam attention monitoring) |
| `end-session` | client → server | `{ sessionId }` (teacher only) |
| `participant-joined` / `participant-left` | server → room | broadcast |
| `attention-update` | server → teacher | `{ userId, score, at }` |
| `session-ended` | server → room | `{ by }` |

## Project Structure

```
src/
├── config/       env + db connection
├── models/       User, ProgressEvent, ChatSession, LiveSession
├── controllers/  auth, user, progress, pal, live
├── routes/       auth, user, progress, pal, live
├── middleware/   requireAuth, requireRole
├── services/     palService (Groq)
├── sockets/      liveSocket (Socket.IO)
├── utils/        token, cookies
├── app.ts        Express app
└── index.ts      HTTP server + Socket.IO
```
