# Production checks, video upload & live camera/mic

## 1. Video upload failing in production - ROOT CAUSE CONFIRMED (2026-07-08)

**Not an nginx body-size issue** (that was an earlier, unconfirmed guess ,
ignore the old version of this doc). Direct testing against the production
API (`https://d3cxm67a2ygkx3.cloudfront.net`) with a valid teacher token
proves the request never reaches the app at all:

```
POST /api/videos  (10KB binary file, valid auth token)
→ HTTP 403, server: CloudFront, x-cache: Error from cloudfront
→ body: "ERROR: The request could not be satisfied - Request blocked."
```

Evidence that isolates this to CloudFront/WAF, not the app or file size:
- A ~5-byte plain-text file through the same endpoint → succeeds (201).
- A 10KB/100KB/200KB **binary** file (`/dev/urandom`) → blocked every time,
  same CloudFront error page, before hitting the origin.
- Normal JSON POSTs (login, etc.) of any size are unaffected.
- GET requests to the same `/api/videos` path work fine.

This is the signature of an **AWS WAF Web ACL rule** attached to the
CloudFront distribution, the "Request blocked" wording (not a generic 403,
not a CloudFront size-limit message) plus `x-cache: Error from cloudfront`
is WAF, not nginx or the app. WAF body-inspection rules (e.g. the AWS Managed
Rules "SizeRestrictions_BODY" or generic anomaly-detection rules) commonly
false-positive on high-entropy binary multipart bodies, exactly what a
video file looks like.

**Action needed (requires AWS Console / WAF access, not SSH):**
1. Go to **AWS WAF & Shield → Web ACLs**, find the one associated with this
   CloudFront distribution.
2. Check the Web ACL's request/block sampling for `/api/videos`, it should
   show which specific rule is firing on the upload requests.
3. Either add a rule exception (exclude `/api/videos` POST from body
   inspection) or increase/adjust the offending rule's body-size/content
   thresholds for that path.
4. Alternatively, if the origin has no WAF requirement, temporarily
   switching the Web ACL to "Count" mode for that rule (log-only, don't
   block) will confirm this diagnosis conclusively before making it permanent.

The app-side code is already correct (confirmed via local multer + Mongo +
streaming, and via the actual 5-byte upload succeeding against prod), this
is purely an AWS-side WAF/CloudFront configuration fix, and the person who
manages the AWS account needs to make it.

## 2. Live class camera/mic - CONFIRMED WORKING (2026-07-08)

Verified end-to-end against production: created a real live session as the
teacher, requested `/api/live/:id/token`, and got back a real, correctly-
scoped LiveKit token (`room: session-<id>`, `canPublish: true`, issuer
matching the real LiveKit project key) - LiveKit is properly configured on
the server now. This item is resolved; no further action needed. (Test
session was ended and torn down immediately after verifying.)

## Note on browser permissions

Camera/mic also requires HTTPS (already true here - CloudFront serves the
frontend and backend over HTTPS), no action needed there.
