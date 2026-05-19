/* ============================================================
   mailer.js — sends email for TalkBoard
   If a mail provider key is configured it sends real email.
   If not, it logs the message to the server console so the
   whole flow can be tested locally with no account or key.
   ============================================================ */
'use strict';

/* ---- configuration ----
   To send real email, set these as environment variables when
   you start the server (or in your host's settings):
     MAIL_PROVIDER   = "resend"
     RESEND_API_KEY  = "re_xxxxxxxx"   (from resend.com)
     MAIL_FROM       = "TalkBoard <no-reply@yourdomain.com>"
   Until then, emails are written to the console instead. */
const PROVIDER = process.env.MAIL_PROVIDER || 'console';
const RESEND_API_KEY = process.env.RESEND_API_KEY || '';
const MAIL_FROM = process.env.MAIL_FROM || 'TalkBoard <onboarding@resend.dev>';

/* Send an email. Returns { ok, mode } and never throws —
   a mail failure should not crash a sign-up. */
async function sendMail({ to, subject, text, html }) {
  // ---- real sending via Resend ----
  if (PROVIDER === 'resend' && RESEND_API_KEY) {
    try {
      const r = await fetch('https://api.resend.com/emails', {
        method: 'POST',
        headers: {
          'Authorization': 'Bearer ' + RESEND_API_KEY,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ from: MAIL_FROM, to: [to], subject, text, html }),
      });
      if (!r.ok) {
        const detail = await r.text().catch(() => '');
        console.error('[mail] Resend rejected the message:', r.status, detail);
        return { ok: false, mode: 'resend' };
      }
      console.log('[mail] sent to', to, 'via Resend');
      return { ok: true, mode: 'resend' };
    } catch (e) {
      console.error('[mail] Resend request failed:', e.message);
      return { ok: false, mode: 'resend' };
    }
  }

  // ---- fallback: log to console so local testing still works ----
  console.log('\n──────── EMAIL (console fallback — no mail key set) ────────');
  console.log('To:      ', to);
  console.log('Subject: ', subject);
  console.log(text || '');
  console.log('────────────────────────────────────────────────────────────\n');
  return { ok: true, mode: 'console' };
}

/* Build the confirmation email for a new member. */
function confirmationEmail(name, link) {
  const subject = 'Confirm your email for TalkBoard';
  const text =
`Hi ${name},

Welcome to TalkBoard. Please confirm your email address by opening
the link below:

${link}

If you didn't create this account, you can ignore this message.

— TalkBoard`;
  const html =
`<div style="font-family:sans-serif;max-width:480px;margin:0 auto">
  <h2 style="color:#5b21e6">Welcome to TalkBoard</h2>
  <p>Hi ${escapeHtml(name)},</p>
  <p>Please confirm your email address to finish setting up your account.</p>
  <p><a href="${escapeHtml(link)}"
     style="display:inline-block;background:#5b21e6;color:#fff;
     padding:12px 22px;border-radius:8px;text-decoration:none;font-weight:700">
     Confirm my email</a></p>
  <p style="color:#6b7280;font-size:13px">
     If the button doesn't work, copy this link:<br>${escapeHtml(link)}</p>
  <p style="color:#6b7280;font-size:13px">
     If you didn't create this account, you can ignore this message.</p>
</div>`;
  return { subject, text, html };
}

function escapeHtml(s) {
  return String(s || '').replace(/[&<>"]/g,
    (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
}

/* true when real email sending is configured */
function mailIsLive() {
  return PROVIDER === 'resend' && !!RESEND_API_KEY;
}

module.exports = { sendMail, confirmationEmail, mailIsLive };
