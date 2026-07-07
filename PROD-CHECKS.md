# Production checks — video upload & live camera/mic

Two tester-reported bugs need verification on the live server (EC2 behind
CloudFront) that I don't have access to from here. The app-side code is
already correct and tested locally; these are config checks.

## 1. Video upload failing in production

Confirmed working locally end-to-end (multer + Mongo + streaming all pass).
Most likely cause: the reverse proxy in front of the app is capping request
body size below the video file size.

```bash
# SSH into the EC2 box, then:

# a) Confirm the app's own .env has real LiveKit + other secrets (compare
#    against local .env — do NOT paste secrets back into chat).
grep -c "LIVEKIT_URL=\|LIVEKIT_API_KEY=\|LIVEKIT_API_SECRET=" /path/to/edulearn-backend/.env
# should print 3 (all present and non-empty)

# b) Check nginx's upload cap (multer itself allows up to 500MB — see
#    src/routes/videoRoutes.ts). If nginx sits in front of Node:
sudo nginx -T 2>/dev/null | grep -i client_max_body_size

# If missing or too small (nginx defaults to 1MB!), add to the relevant
# server{} or location{} block for the API:
#   client_max_body_size 520M;
# then:
sudo nginx -t && sudo systemctl reload nginx

# c) If CloudFront sits in front of nginx, check its origin request policy /
# size limits too — CloudFront has its own request body cap depending on
# distribution settings.
```

After the nginx fix, re-test with a real video file from upload.html — the
app now returns a clear JSON error (`"Video is too large (max 500 MB)."` or
the real reason) instead of an opaque 500, so any remaining failure will be
self-explanatory in the browser.

## 2. Live class camera/mic not working

LiveKit env vars exist correctly in the **local** `.env` (`LIVEKIT_URL`,
`LIVEKIT_API_KEY`, `LIVEKIT_API_SECRET`). If they're missing/blank in
production, `env.livekitConfigured` is false and `/api/live/:id/token`
returns 503 — the frontend then has nothing to connect the video stage to,
which reads exactly like "camera/mic not working."

```bash
# On the server:
grep -c "LIVEKIT_URL=\|LIVEKIT_API_KEY=\|LIVEKIT_API_SECRET=" /path/to/edulearn-backend/.env

# If any are missing, add them (same values as local .env, from
# https://cloud.livekit.io -> your project), then reload so PM2 picks up
# the new env (PM2 does NOT re-read .env on its own):
pm2 restart edulearn-backend --update-env
```

Also confirm the LiveKit project isn't paused/over-quota on
cloud.livekit.io — a valid-looking token can still fail to connect if the
project itself is suspended.

## Note on browser permissions

Camera/mic also requires HTTPS (already true here — CloudFront serves the
frontend and backend over HTTPS) — no action needed there, just flagging
that this was independently confirmed, not a suspect.
