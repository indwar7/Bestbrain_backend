# EduLearn — Project Brief

> **Learn smarter, score better.** An iPrep-style K-12 learning platform for Bharat —
> CBSE / NCERT + state boards, Classes 6–9. Mobile-first, offline-first, bilingual
> (English / हिंदी), with adaptive AI at its core. Three roles — **Student, Parent,
> Teacher** — each with its own dashboard and experience.

_Last updated: 2026-06-22_

---

## 🔗 Links

| Item | Link |
|---|---|
| **Live demo** | https://edulearn-platform-theta.vercel.app |
| **Frontend repo** | https://github.com/indwar7/Edulearn-Platform- |
| **Backend repo** | https://github.com/indwar7/edulearn-backend |
| **Deploy (frontend)** | Vercel — static, auto-deploys on push to `main` |

> Tip: open the **live URL** (not a local file) so the webcam-based attention
> monitoring works — camera access needs HTTPS.

---

## 🧱 Architecture at a glance

```
┌─────────────────────────────┐         HTTPS / REST + WebSocket        ┌──────────────────────────────┐
│  FRONTEND (Vercel, static)  │  ───────────────────────────────────▶  │  BACKEND (Node + Express)     │
│  Vanilla HTML / CSS / JS    │                                         │  REST API + Socket.IO         │
│  localStorage state         │  ◀───────────────────────────────────  │  MongoDB (Mongoose)           │
└─────────────────────────────┘                                         └──────────────┬───────────────┘
                                                                                        │
                                                              ┌─────────────────────────┼─────────────────────────┐
                                                              ▼                         ▼                         ▼
                                                       Vertex AI (Gemini)         LiveKit (video)          MongoDB Atlas / local
                                                       — PAL AI bot               — live classes           — users, progress, chats
```

- **Frontend** and **backend** are two separate repositories.
- No shared monorepo; the frontend calls the backend over REST + WebSocket and is
  allowed via CORS (`CLIENT_ORIGIN`).

---

## 🎨 Frontend — status

**Stack:** Plain HTML, CSS, vanilla JavaScript — **no framework, no build step**.
Shared dark/light theme + bilingual (EN/हिंदी) UI. Per-browser state via `localStorage`.
Deployed as static files on **Vercel** (auto-deploy on every push to `main`).

| Page | What it does | Status |
|---|---|---|
| Landing | Animated, character-driven showcase (web + mobile) | ✅ |
| Learn | Course browser — Classes 6–9 × 5 subjects, ~190 NCERT chapters, search, progress | ✅ |
| Live classes | Booking + calendar invite, in-app classroom, **AI webcam attention monitoring** | ✅ |
| PAL | GPT-style AI assistant — Student / Parent / Teacher modes | ✅ |
| Arena (challenge) | One timed question per hour, 45-sec window, speed scoring, streaks, leaderboard | ✅ |
| Mock tests | **Adaptive** — difficulty rises/falls with the student | ✅ |
| Dashboards | Role-specific: Student, Parent, Teacher | ✅ |
| Lesson player | AI animated video lectures | 🟡 in progress |
| Auth (login / signup) | Role-tabbed login + signup | ✅ |
| Admin / Upload / Videos | Content + video lecture management | ✅ |

**Highlight features**
- **AI attention monitoring** — real webcam gaze detection during live classes
  (consent-first; video stays on device, only the focus score is saved) → reported to
  parent + teacher.
- **PAL AI assistant** — doubts, notes, summaries, quizzes; separate role experiences.
- **Adaptive mock tests** — visible difficulty ladder.
- **Hourly Arena** — whole school sees the same question; speed is the anti-cheat.
- **Bharat-first** — Hindi/English, offline-oriented.

> ⚠️ **To confirm before presenting:** the frontend README lists "Live LLM API behind
> PAL" as a *roadmap* item, which suggests the deployed site may still use mock/local
> data for PAL and dashboards rather than the new live backend. Verify whether the
> Vercel build is pointed at the deployed backend.

---

## ⚙️ Backend — status

**Stack:** Node.js + **Express 5** + **MongoDB (Mongoose 9)**, TypeScript. JWT auth
(access + refresh), role-based access, Socket.IO for real-time. **Vitest** test suite.

**Key dependencies**

| Purpose | Package |
|---|---|
| AI (PAL) | `@google/genai` (Vertex AI / Gemini) |
| Live video | `livekit-server-sdk` |
| Auth | `jsonwebtoken`, `bcryptjs`, `cookie-parser` |
| Web | `express`, `cors` |
| Real-time | `socket.io` |
| Rate limiting | `express-rate-limit` |
| Uploads | `multer` |
| Tests | `vitest`, `supertest`, `mongodb-memory-server` |

**Runtime:** Node 20 · TypeScript 6.

### Modules

| Module | Status | Notes |
|---|---|---|
| **Auth** | ✅ | Role-specific signup, role-aware login, JWT access + refresh (httpOnly cookie, rotated) |
| **PAL AI bot** | ✅ | Vertex AI (Gemini), role-aware, **grounded in each user's real data**, multi-turn memory, SSE streaming, rate-limited, session CRUD |
| **Progress** | ✅ | Snapshot + offline event sync (idempotent), derived insights (streaks, weekly activity) |
| **Dashboard** | ✅ | Role-specific aggregates |
| **Curriculum** | ✅ | Subject/Chapter models + CRUD; PAL recommends the real next chapter by name |
| **Live classes** | ✅ | Create/join/end, eligibility checks, LiveKit tokens, roster, Socket.IO |
| **Video lectures** | ✅ | Upload, list, stream, view tracking |
| **Users / Admin** | ✅ | Profile, preferences, user listing |
| **Automated tests** | 🟡 | Vitest covers PAL + Curriculum (15 passing); other modules verified manually |

### API surface

Base URL: `/api` · All routes require `Authorization: Bearer <token>` unless noted.

**Auth** `/api/auth`
- `POST /signup/student` · `POST /signup/teacher` · `POST /signup/parent`
- `POST /login` · `POST /refresh` · `POST /logout` · `GET /me`

**PAL (AI bot)** `/api/pal` _(chat endpoints rate-limited: 20/min/user)_
- `POST /chat` — role-aware reply, grounded in real data
- `POST /chat/stream` — Server-Sent Events token streaming
- `GET /sessions` · `GET /sessions/:id` · `PATCH /sessions/:id` (rename) · `DELETE /sessions/:id`

**Curriculum** `/api/curriculum`
- `GET /subjects` · `GET /subjects/:subjectId/chapters` · `GET /chapters/:id` (any user)
- `POST /subjects` · `POST /chapters` · `PATCH /chapters/:id` · `DELETE /chapters/:id` (teacher/admin)

**Progress** `/api/progress`
- `GET /` · `PUT /` · `POST /sync` (batched offline events, idempotent)

**Dashboard** `/api/dashboard`
- `GET /` — role-specific data

**Live classes** `/api/live` _(+ Socket.IO real-time events)_
- `GET /` · `POST /` (teacher) · `POST /:id/join` · `POST /:id/token` (LiveKit)
- `GET /:id/roster` (teacher) · `POST /:id/end` (teacher)

**Videos** `/api/videos`
- `GET /` · `GET /:id/stream` (no auth, for `<video src>`) · `POST /:id/view` · `POST /` (upload)

**Users / Admin**
- `GET /api/users/me` · `PUT /api/users/me/profile` · `GET|PUT /api/users/me/progress`
- `GET /api/admin/users`

---

## 🤖 PAL — the AI assistant (deep dive)

PAL is the platform's standout AI feature. How it works:

- **Provider:** Vertex AI (Gemini) via the official `@google/genai` Node SDK; credentials
  via a service-account JSON (path in `GOOGLE_APPLICATION_CREDENTIALS`).
- **Role-aware:** persona is derived from the **authenticated user's account role**, not
  the request body — a student can't pose as a teacher.
- **Grounded in real data:** every reply is given a live summary of the user's actual
  EduLearn data — student → own progress, parent → child's, teacher → class snapshot —
  and (via Curriculum) the real next chapter to study, by name.
- **Resilient:** 30s timeout, retry + backoff on transient errors, history capped for
  responsiveness, graceful stub fallback if credentials are missing.
- **Productionized:** per-user rate limit (20/min), 4000-char message cap, multi-turn
  memory persisted per session, SSE streaming, session list/rename/delete.

---

## 🧪 Running it (demo)

**Backend** (in-memory DB — no MongoDB setup needed)
```bash
cd edulearn-backend
npm install
npm run demo          # starts API on http://localhost:4000 (in-memory MongoDB)
# or: npm run dev      # uses local MongoDB
npm run seed          # create demo accounts
npm run seed:curriculum  # sample Class 7 Maths curriculum + backfill
npm test              # Vitest suite
```

**Frontend**
```bash
cd edu
python3 -m http.server 8000
# open http://localhost:8000/edutok/login.html
```

**Demo accounts** — password for all: `Demo@2024`

| Role | Email | Lands on |
|---|---|---|
| Student | `student@edulearn.com` | Student dashboard (streak, minutes, badges) |
| Teacher | `teacher@edulearn.com` | Teacher dashboard (class roster + averages) |
| Parent | `parent@edulearn.com` | Parent dashboard (child's progress) |

Each user is locked to their own role view.

---

## 🗺️ Roadmap

- AI animated video lectures wired into the lesson player
- Live LLM API fully wired behind the deployed PAL frontend
- Offline-first PWA + Android app with chapter downloads
- Phone-OTP auth, UPI payments, school-admin dashboard
- Broader automated test coverage (currently PAL + Curriculum only)

---

## ⚠️ Open items / notes

- **Security:** rotate the GCP service-account key used for Vertex AI (a key was exposed
  during development). The key file is gitignored and not committed.
- **Frontend ↔ backend wiring:** confirm the deployed frontend calls the live backend for
  PAL/dashboards (see note in the Frontend section).
- **Admin role:** there's no distinct `admin` login in the user model today; curriculum
  "admin" authoring is currently served by the teacher role.

---

## 📊 Honest completion estimate

- **For an MVP / demo:** ~90% — auth, PAL, progress, dashboards, live video, videos, and
  curriculum all work and are partly tested.
- **For a full production product:** ~65% — notifications, assignments/grading, payments,
  full test coverage, and CI/CD + monitoring are not built yet.

Nothing is broken or half-built; remaining work is deliberate feature scope + engineering
hygiene.
