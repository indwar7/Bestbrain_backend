# EduLearn Backend

REST API for the [EduLearn](https://edulearn-platform-theta.vercel.app) learning platform —
handles authentication, user profiles, and learning progress (PAL, streaks, badges, chapters).

Built with **Node.js + Express + TypeScript + MongoDB**.

## Tech Stack

| Layer | Tool |
|-------|------|
| Runtime | Node.js 20 |
| Framework | Express 5 |
| Language | TypeScript |
| Database | MongoDB (Mongoose) |
| Auth | JWT + bcrypt |

## Getting Started

```bash
# 1. Install dependencies
npm install

# 2. Create your .env from the template
cp .env.example .env
# then fill in MONGODB_URI and JWT_SECRET

# 3. Run in dev (auto-reload)
npm run dev

# 4. Build + run for production
npm run build
npm start
```

Server runs at `http://localhost:4000`.

## Environment Variables

See [.env.example](.env.example). You need a free MongoDB Atlas cluster:
1. Sign up at https://cloud.mongodb.com
2. Create a free M0 cluster
3. Database Access → add a user
4. Network Access → allow `0.0.0.0/0` (for dev)
5. Copy the connection string into `MONGODB_URI`

## API Endpoints

| Method | Route | Auth | Description |
|--------|-------|------|-------------|
| GET  | `/` | – | Health check |
| POST | `/api/auth/signup` | – | Register `{ name, email, password, role? }` |
| POST | `/api/auth/login` | – | Login `{ email, password }` → returns JWT |
| GET  | `/api/users/me` | ✅ | Current user profile |
| GET  | `/api/users/me/progress` | ✅ | Get learning progress |
| PUT  | `/api/users/me/progress` | ✅ | Save learning progress (partial merge) |

Authenticated routes require a header: `Authorization: Bearer <token>`.

## Connecting the Frontend

The frontend currently stores state in `localStorage`. Replace those calls with `fetch`:

```js
// Login
const res = await fetch("https://YOUR-API-URL/api/auth/login", {
  method: "POST",
  headers: { "Content-Type": "application/json" },
  body: JSON.stringify({ email, password }),
});
const { token, user } = await res.json();
localStorage.setItem("edulearn_token", token);

// Authenticated request
await fetch("https://YOUR-API-URL/api/users/me/progress", {
  method: "PUT",
  headers: {
    "Content-Type": "application/json",
    Authorization: `Bearer ${localStorage.getItem("edulearn_token")}`,
  },
  body: JSON.stringify({ minutes: 120, streak: 5 }),
});
```

## Project Structure

```
src/
├── config/       # env + db connection
├── models/       # Mongoose schemas (User)
├── controllers/  # route handlers (auth, user)
├── routes/       # Express routers
├── middleware/   # JWT auth guard
├── utils/        # token signing
├── app.ts        # Express app setup
└── index.ts      # entry point
```
