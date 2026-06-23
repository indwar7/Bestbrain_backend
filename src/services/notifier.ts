import { env } from "../config/env";

// Provider-agnostic notification layer. Each channel picks a real provider when
// credentials are configured, otherwise logs to the console so the full OTP flow
// works in development without any third-party account.
//
// To add a real provider later, implement the send call inside the matching
// branch (the TODOs below) — no other code needs to change.

export type SendResult = { delivered: boolean; via: string };

// ---------------------------------------------------------------------------
// EMAIL
// ---------------------------------------------------------------------------
export async function sendEmail(
  to: string,
  subject: string,
  text: string
): Promise<SendResult> {
  if (env.emailProvider === "resend" && env.resendApiKey) {
    // TODO: real send. Example (uncomment once `resend` is installed):
    //   const { Resend } = await import("resend");
    //   await new Resend(env.resendApiKey).emails.send({
    //     from: env.emailFrom, to, subject, text,
    //   });
    const res = await fetch("https://api.resend.com/emails", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${env.resendApiKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ from: env.emailFrom, to, subject, text }),
    });
    if (!res.ok) throw new Error(`Resend error ${res.status}: ${await res.text()}`);
    return { delivered: true, via: "resend" };
  }

  if (env.emailProvider === "sendgrid" && env.sendgridApiKey) {
    const res = await fetch("https://api.sendgrid.com/v3/mail/send", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${env.sendgridApiKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        personalizations: [{ to: [{ email: to }] }],
        from: { email: env.emailFrom },
        subject,
        content: [{ type: "text/plain", value: text }],
      }),
    });
    if (!res.ok) throw new Error(`SendGrid error ${res.status}: ${await res.text()}`);
    return { delivered: true, via: "sendgrid" };
  }

  // No provider configured — log it (dev fallback).
  console.log(`\n📧 [DEV EMAIL] to=${to}\n   subject: ${subject}\n   ${text}\n`);
  return { delivered: false, via: "console" };
}

// ---------------------------------------------------------------------------
// SMS
// ---------------------------------------------------------------------------
export async function sendSms(to: string, text: string): Promise<SendResult> {
  if (env.smsProvider === "msg91" && env.msg91AuthKey) {
    const res = await fetch("https://api.msg91.com/api/v5/flow/", {
      method: "POST",
      headers: { authkey: env.msg91AuthKey, "Content-Type": "application/json" },
      // NOTE: MSG91 v5 uses template flows; adjust template_id/vars when set up.
      body: JSON.stringify({
        template_id: env.msg91TemplateId,
        sender: env.msg91Sender,
        mobiles: to,
        otp: text,
      }),
    });
    if (!res.ok) throw new Error(`MSG91 error ${res.status}: ${await res.text()}`);
    return { delivered: true, via: "msg91" };
  }

  if (env.smsProvider === "twilio" && env.twilioSid && env.twilioToken) {
    const body = new URLSearchParams({
      To: to,
      From: env.twilioFrom,
      Body: text,
    });
    const res = await fetch(
      `https://api.twilio.com/2010-04-01/Accounts/${env.twilioSid}/Messages.json`,
      {
        method: "POST",
        headers: {
          Authorization:
            "Basic " +
            Buffer.from(`${env.twilioSid}:${env.twilioToken}`).toString("base64"),
          "Content-Type": "application/x-www-form-urlencoded",
        },
        body,
      }
    );
    if (!res.ok) throw new Error(`Twilio error ${res.status}: ${await res.text()}`);
    return { delivered: true, via: "twilio" };
  }

  console.log(`\n📱 [DEV SMS] to=${to}\n   ${text}\n`);
  return { delivered: false, via: "console" };
}
