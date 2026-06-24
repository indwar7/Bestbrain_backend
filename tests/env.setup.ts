// Runs before any test module is imported. Forces OTP into console/dev mode so
// tests never hit a real email/SMS provider, regardless of what's in .env.
process.env.EMAIL_PROVIDER = "";
process.env.SMS_PROVIDER = "";
process.env.RESEND_API_KEY = "";
process.env.SENDGRID_API_KEY = "";
process.env.MSG91_AUTH_KEY = "";
process.env.TWILIO_ACCOUNT_SID = "";
process.env.TWILIO_AUTH_TOKEN = "";
// Keep the verification gate ON in tests (matches production intent).
process.env.OTP_ENFORCED = "true";
