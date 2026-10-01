// Runs before any test module is imported. Forces OTP into console/dev mode so
// tests never hit a real email/SMS provider, regardless of what's in .env.
process.env.NODE_ENV = "test"; // disables rate limiting so auth suites aren't throttled
process.env.EMAIL_PROVIDER = "";
process.env.SMS_PROVIDER = "";
process.env.RESEND_API_KEY = "";
process.env.SENDGRID_API_KEY = "";
process.env.MSG91_AUTH_KEY = "";
process.env.TWILIO_ACCOUNT_SID = "";
process.env.TWILIO_AUTH_TOKEN = "";
// Keep the verification gate ON in tests (matches production intent).
process.env.OTP_ENFORCED = "true";
// A fixed test secret so subscription.test.ts can sign real webhook payloads
// with crypto and have verifyWebhookSignature actually accept them, env.ts
// reads this once at import time, so it has to be set before any test module
// (and therefore src/config/env.ts) is imported, which is exactly what this
// setup file is for.
process.env.RAZORPAY_WEBHOOK_SECRET = "test_webhook_secret";
// Most coin suites assert exact balances from zero; the welcome bonus has its
// own test that switches it on.
process.env.WELCOME_COINS = "0";
// Test Razorpay API keys, so the coin store is "switched on" and checkout
// signatures can be computed in coinStore.test.ts. No real call is made: the
// Orders API is stubbed there.
process.env.RAZORPAY_KEY_ID = "rzp_test_key";
process.env.RAZORPAY_KEY_SECRET = "rzp_test_secret";
