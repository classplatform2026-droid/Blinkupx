import crypto from 'node:crypto';
import bcrypt from 'bcryptjs';
import {
  env,
  getMissingOtpVars,
  isOtpProviderConfigured,
} from '../config/env.ts';
import { OtpVerification, type OtpPurpose } from '../models/OtpVerification.ts';
import { AppError } from '../utils/errors.ts';

const OTP_TTL_MS = 5 * 60 * 1000;
const RESEND_COOLDOWN_MS = 60 * 1000;

export function normalizePhone(rawPhone: string): string {
  const cleaned = rawPhone.replace(/[^\d+]/g, '');
  const bdMatch = cleaned.match(/^(?:\+?88)?(01\d{9})$/);
  if (bdMatch) {
    return bdMatch[1];
  }
  if (cleaned.startsWith('+')) {
    return cleaned;
  }
  return `+${cleaned}`;
}

function toE164ForSms(phone: string): string {
  if (/^01\d{9}$/.test(phone)) {
    return `+88${phone}`;
  }
  return phone.startsWith('+') ? phone : `+${phone}`;
}

async function dispatchEmailOtp(
  email: string,
  code: string,
  purpose: OtpPurpose
): Promise<void> {
  const actionLabel =
    purpose === 'register' ? 'Verify your BlinkUpZ account' : 'Reset your BlinkUpZ password';

  const html = `
    <div style="font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif; background:#181818; color:#ffffff; padding:32px; border-radius:12px; max-width:480px; margin:0 auto;">
      <h2 style="margin:0 0 8px; font-size:20px; font-weight:700;">BlinkUpZ</h2>
      <p style="margin:0 0 24px; color:#999999; font-size:14px;">${actionLabel}</p>
      <div style="background:#242424; border:1px solid #303030; border-radius:10px; padding:20px; text-align:center; margin-bottom:20px;">
        <span style="font-family:monospace; font-size:32px; font-weight:700; letter-spacing:8px; color:#ffffff;">${code}</span>
      </div>
      <p style="margin:0; color:#999999; font-size:13px; line-height:1.5;">
        Enter this 6-digit verification code in BlinkUpZ. This code expires in 5 minutes. If you did not request it, you can ignore this email.
      </p>
    </div>
  `;

  const resp = await fetch('https://api.resend.com/emails', {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${env.otp.resendApiKey}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      from: env.otp.emailFrom,
      to: [email],
      subject: `${code} is your BlinkUpZ verification code`,
      html,
      text: `Your BlinkUpZ verification code is ${code}. It expires in 5 minutes.`,
    }),
  });

  if (!resp.ok) {
    let reason = `Resend email delivery failed (${resp.status}).`;
    try {
      const errBody = (await resp.json()) as { message?: string };
      if (errBody?.message) reason = errBody.message;
    } catch {
      // Ignore JSON parse error
    }
    throw new AppError(reason, 424, 'OTP_DELIVERY_FAILED');
  }
}

async function dispatchOtp(
  phone: string,
  code: string,
  purpose: OtpPurpose,
  email?: string
): Promise<void> {
  if (!isOtpProviderConfigured()) {
    const missing = getMissingOtpVars();
    throw new AppError(
      `OTP provider (${env.otp.provider}) is not configured. Set ${missing.join(', ')} in server environment variables.`,
      422,
      'OTP_PROVIDER_NOT_CONFIGURED',
      { provider: env.otp.provider, missingVars: missing }
    );
  }

  if (env.otp.provider === 'resend') {
    if (!email) {
      throw new AppError(
        'An email address is required to send your verification code.',
        400,
        'EMAIL_REQUIRED'
      );
    }
    await dispatchEmailOtp(email, code, purpose);
    return;
  }

  const label = purpose === 'register' ? 'verification' : 'password reset';
  const bodyText = `Your BlinkUpZ ${label} code is ${code}. It expires in 5 minutes.`;
  const smsRecipient = toE164ForSms(phone);

  if (env.otp.provider === 'webhook') {
    const headers: Record<string, string> = {
      'Content-Type': 'application/json',
    };
    if (env.otp.webhookSecret) {
      headers['X-Webhook-Secret'] = env.otp.webhookSecret;
    }
    const resp = await fetch(env.otp.webhookUrl, {
      method: 'POST',
      headers,
      body: JSON.stringify({
        phone: smsRecipient,
        localPhone: phone,
        email,
        code,
        purpose,
        message: bodyText,
        app: 'BlinkUpZ',
      }),
    });
    if (!resp.ok) {
      throw new AppError(
        `OTP webhook delivery failed with status ${resp.status}.`,
        424,
        'OTP_DELIVERY_FAILED'
      );
    }
    return;
  }

  // Twilio SMS REST API
  const url = `https://api.twilio.com/2010-04-01/Accounts/${encodeURIComponent(
    env.otp.twilioAccountSid
  )}/Messages.json`;
  const auth = Buffer.from(
    `${env.otp.twilioAccountSid}:${env.otp.twilioAuthToken}`
  ).toString('base64');

  const form = new URLSearchParams({
    To: smsRecipient,
    From: env.otp.twilioPhoneNumber,
    Body: bodyText,
  });

  const resp = await fetch(url, {
    method: 'POST',
    headers: {
      Authorization: `Basic ${auth}`,
      'Content-Type': 'application/x-www-form-urlencoded',
    },
    body: form.toString(),
  });

  if (!resp.ok) {
    const detail = await resp.text().catch(() => '');
    throw new AppError(
      `Twilio SMS delivery failed (${resp.status}). ${detail.slice(0, 140)}`,
      424,
      'OTP_DELIVERY_FAILED'
    );
  }
}

export async function issueOtp(
  rawPhone: string,
  purpose: OtpPurpose,
  email?: string
): Promise<{ cooldownSeconds: number; expiresAt: Date }> {
  const phone = normalizePhone(rawPhone);
  const now = new Date();

  const existing = await OtpVerification.findOne({
    phone,
    purpose,
    consumedAt: null,
    expiresAt: { $gt: now },
  }).sort({ createdAt: -1 });

  if (existing) {
    const elapsed = now.getTime() - existing.lastSentAt.getTime();
    if (elapsed < RESEND_COOLDOWN_MS) {
      const waitSeconds = Math.ceil((RESEND_COOLDOWN_MS - elapsed) / 1000);
      throw new AppError(
        `Please wait ${waitSeconds}s before requesting another verification code.`,
        429,
        'OTP_COOLDOWN',
        { retryAfterSeconds: waitSeconds }
      );
    }
  }

  const code = String(crypto.randomInt(100000, 1000000));
  const codeHash = await bcrypt.hash(code, 10);
  const expiresAt = new Date(now.getTime() + OTP_TTL_MS);

  await dispatchOtp(phone, code, purpose, email);

  await OtpVerification.deleteMany({ phone, purpose, consumedAt: null });
  await OtpVerification.create({
    phone,
    purpose,
    codeHash,
    attempts: 0,
    maxAttempts: 5,
    expiresAt,
    lastSentAt: now,
  });

  return {
    cooldownSeconds: Math.floor(RESEND_COOLDOWN_MS / 1000),
    expiresAt,
  };
}

export async function verifyOtpCode(
  rawPhone: string,
  code: string,
  purpose: OtpPurpose
): Promise<void> {
  const phone = normalizePhone(rawPhone);
  const now = new Date();

  const record = await OtpVerification.findOne({
    phone,
    purpose,
    consumedAt: null,
    expiresAt: { $gt: now },
  }).sort({ createdAt: -1 });

  if (!record) {
    throw new AppError(
      'Verification code has expired or was not found. Please request a new code.',
      400,
      'OTP_EXPIRED_OR_MISSING'
    );
  }

  if (record.attempts >= record.maxAttempts) {
    throw new AppError(
      'Maximum verification attempts reached. Please request a new code.',
      429,
      'OTP_MAX_ATTEMPTS'
    );
  }

  const isMatch = await bcrypt.compare(code.trim(), record.codeHash);
  if (!isMatch) {
    record.attempts += 1;
    await record.save();
    const remaining = Math.max(0, record.maxAttempts - record.attempts);
    throw new AppError(
      `Invalid verification code. ${remaining} attempt${remaining === 1 ? '' : 's'} remaining.`,
      400,
      'OTP_INVALID',
      { attemptsRemaining: remaining }
    );
  }

  record.consumedAt = now;
  await record.save();
}
