# Bestbrainplus


REST + WebSocket API for the [EduLearn](https://edulearn-platform-theta.vercel.app) learning platform ,
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

# Easiest: run with a zero-setup in-memory database (no MongoDB needed)
USE_MEMORY_DB=true npm run seed   # create demo accounts
USE_MEMORY_DB=true npm run dev    # http://localhost:4000

# Or with a real database:
cp .env.example .env              # fill in MONGODB_URI + JWT secrets
npm run seed && npm run dev

npm run build && npm start        # production
```

> **In-memory mode**: if `MONGODB_URI` is empty or `USE_MEMORY_DB=true`, the app
> spins up a temporary MongoDB in memory, great for demos. Data resets on restart.

### Demo accounts (after `npm run seed`)

All use password **`Demo@2024`**:

| Role | Email | Identity |
|------|-------|----------|
| Student | `student@edulearn.com` | roll `EDU-7A-021`, Class 7-A, CBSE |
| Student | `student2@edulearn.com` | roll `EDU-7B-008`, Class 7-B |
| Parent | `parent@edulearn.com` | linked to Aarav (`EDU-7A-021`) |
| Teacher | `teacher@edulearn.com` | id `TCH-104`, teaches Class 7-A Science/Maths |

## Auth model

Two tokens:
- **Access token**, short-lived (15 min), returned in the JSON body, sent as `Authorization: Bearer <token>`.
- **Refresh token**, long-lived (7 days), stored in an **httpOnly cookie**, rotated on every `/auth/refresh`.

On app load, the frontend calls **`GET /api/auth/me`** to hydrate the session.
When the access token expires, call **`POST /api/auth/refresh`** to get a new one.

## API Endpoints

### Auth, three separate role-based signups + one role-aware login
| Method | Route | Auth | Body |
|--------|-------|------|------|
| POST | `/api/auth/signup/student` | – | `{ name, email, password, rollNumber, className, section, board?, subjects? }` |
| POST | `/api/auth/signup/teacher` | – | `{ name, email, password, teacherId, className, section, subject? }` |
| POST | `/api/auth/signup/parent` | – | `{ name, email, password, childRollNumber, childName, childClass }` |
| POST | `/api/auth/login` | – | `{ email, password, role }` - `role` is the tab the user picked; must match the account |
| POST | `/api/auth/refresh` | cookie | New access token (rotates refresh cookie) |
| POST | `/api/auth/logout` | – | Clears refresh cookie |
| GET  | `/api/auth/me` | ✅ | Hydrate current user session (role-specific profile) |

**Per-role signup fields**
- **Student** → `rollNumber`, `className`, `section`, `board` (+ optional `subjects`). Roll number must be unique.
- **Teacher** → `teacherId`, `className`, `section`, `subject`. Teacher ID must be unique.
- **Parent** → links to an existing student by `childRollNumber` + `childName` + `childClass`.
  The student must exist **and** name + class must match the roll number (verification), else the signup is rejected.

Signup returns the access token + a **role-specific user object** (student gets roll/class/section/board;
teacher gets teacherId/teaches; parent gets their linked children).

### Dashboard (role-specific)
| Method | Route | Auth | Returns |
|--------|-------|------|---------|
| GET | `/api/dashboard` | ✅ | Branches by role: **student** → own stats; **parent** → children's summaries; **teacher** → class roster + averages |

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
Re-sending the same `clientEventId` is safe, already-applied events are skipped.

### PAL AI
| Method | Route | Auth | Description |
|--------|-------|------|-------------|
| POST | `/api/pal/chat` | ✅ | `{ role, message, sessionId? }` → `{ sessionId, reply }`. History stored per session in DB. |
| GET  | `/api/pal/sessions/:id` | ✅ | Full conversation history |

Set `GROQ_API_KEY` for real LLM replies; otherwise returns a stub so the flow works in dev.

### Live classes (REST), class + section + subject targeting
| Method | Route | Auth | Description |
|--------|-------|------|-------------|
| GET  | `/api/live` | ✅ | Eligible live sessions (student → own class+section+subjects; teacher → own) |
| POST | `/api/live` | ✅ teacher | Create `{ title, className, section, subject }`, teacher must be assigned to it |
| POST | `/api/live/:id/join` | ✅ | **Eligibility-checked** join → returns room info |
| POST | `/api/live/:id/end` | ✅ teacher | End a session |

**Targeting rules** ([`liveEligibility.ts`](src/services/liveEligibility.ts)): a student can join only if their
`className` **and** `section` match the session **and** they take the `subject`. The owning teacher can always
join. Parents and other teachers are denied. Same rules are enforced in `POST /:id/join` **and** in the
Socket.IO `join-session` event (which emits `join-ok` / `join-denied`).

> Video is intentionally provider-agnostic for now. `LiveSession` has empty `videoProvider` / `videoRoom`
> fields ready to be filled when a video SDK (LiveKit / 100ms) is wired in. Socket.IO already handles the
> realtime room + attention monitoring.

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
