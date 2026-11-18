import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import dotenv from 'dotenv';
import * as webpush from 'web-push';

dotenv.config();

function getOrCreateFallbackJwtSecret(): string {
  const dataDir = path.resolve(process.cwd(), '.data');
  const secretFile = path.join(dataDir, '.jwt_secret');
  try {
    if (fs.existsSync(secretFile)) {
      const existing = fs.readFileSync(secretFile, 'utf8').trim();
      if (existing.length >= 32) {
        return existing;
      }
    }
    fs.mkdirSync(dataDir, { recursive: true });
    const generated = crypto.randomBytes(48).toString('hex');
    fs.writeFileSync(secretFile, generated, { mode: 0o600 });
    return generated;
  } catch {
    return crypto.randomBytes(48).toString('hex');
  }
}

function getOrCreateVapidKeys(): { publicKey: string; privateKey: string; fromEnv: boolean } {
  const envPublic = (process.env.VAPID_PUBLIC_KEY || '').trim().replace(/^["']|["']$/g, '');
  const envPrivate = (process.env.VAPID_PRIVATE_KEY || '').trim().replace(/^["']|["']$/g, '');
  if (envPublic && envPrivate) {
    return { publicKey: envPublic, privateKey: envPrivate, fromEnv: true };
  }

  const dataDir = path.resolve(process.cwd(), '.data');
  const vapidFile = path.join(dataDir, '.vapid_keys.json');
  try {
    if (fs.existsSync(vapidFile)) {
      const parsed = JSON.parse(fs.readFileSync(vapidFile, 'utf8')) as {
        publicKey?: string;
        privateKey?: string;
      };
      if (parsed.publicKey && parsed.privateKey) {
        return { publicKey: parsed.publicKey, privateKey: parsed.privateKey, fromEnv: false };
      }
    }
    fs.mkdirSync(dataDir, { recursive: true });
    const generated = webpush.generateVAPIDKeys();
    fs.writeFileSync(vapidFile, JSON.stringify(generated), { mode: 0o600 });
    return { ...generated, fromEnv: false };
  } catch {
    const generated = webpush.generateVAPIDKeys();
    return { ...generated, fromEnv: false };
  }
}

const runtimeFallbackJwtSecret = process.env.JWT_SECRET ? '' : getOrCreateFallbackJwtSecret();
const resolvedVapid = getOrCreateVapidKeys();

const detectedOtpProvider = (
  process.env.OTP_PROVIDER ||
  (process.env.RESEND_API_KEY ? 'resend' : 'twilio')
).toLowerCase();

export const env = {
  port: Number(process.env.PORT || 3000),
  nodeEnv: process.env.NODE_ENV || 'development',
  isProd: process.env.NODE_ENV === 'production',
  clientUrl: process.env.CLIENT_URL || process.env.APP_URL || 'http://localhost:3000',
  mongodbUri: process.env.MONGODB_URI || '',
  jwtSecret: process.env.JWT_SECRET || runtimeFallbackJwtSecret,
  jwtSecretConfigured: Boolean(process.env.JWT_SECRET),
  jwtExpiresIn: process.env.JWT_EXPIRES_IN || '7d',
  cloudinary: {
    cloudName: process.env.CLOUDINARY_CLOUD_NAME || '',
    apiKey: process.env.CLOUDINARY_API_KEY || '',
    apiSecret: process.env.CLOUDINARY_API_SECRET || '',
  },
  webPush: {
    publicKey: resolvedVapid.publicKey,
    privateKey: resolvedVapid.privateKey,
    subject: (
      process.env.VAPID_SUBJECT || 'mailto:noreply@blinkupx.zumooflex.shop'
    )
      .trim()
      .replace(/^["']|["']$/g, ''),
    fromEnv: resolvedVapid.fromEnv,
  },
  livekit: {
    url: (process.env.LIVEKIT_URL || '').trim().replace(/^["']|["']$/g, ''),
    apiKey: (process.env.LIVEKIT_API_KEY || '').trim().replace(/^["']|["']$/g, ''),
    apiSecret: (process.env.LIVEKIT_API_SECRET || '').trim().replace(/^["']|["']$/g, ''),
  },
  callRingTimeoutMs: Math.min(
    90_000,
    Math.max(15_000, Number(process.env.CALL_RING_TIMEOUT_MS) || 35_000)
  ),
  otp: {
    provider: detectedOtpProvider,
    resendApiKey: process.env.RESEND_API_KEY || '',
    emailFrom: (
      process.env.EMAIL_FROM || 'BlinkUpZ <noreply@blinkupx.zumooflex.shop>'
    )
      .trim()
      .replace(/^["']|["']$/g, ''),
    twilioAccountSid: process.env.TWILIO_ACCOUNT_SID || '',
    twilioAuthToken: process.env.TWILIO_AUTH_TOKEN || '',
    twilioPhoneNumber: process.env.TWILIO_PHONE_NUMBER || '',
    webhookUrl: process.env.OTP_WEBHOOK_URL || '',
    webhookSecret: process.env.OTP_WEBHOOK_SECRET || '',
  },
};

export function isCloudinaryConfigured(): boolean {
  return Boolean(
    env.cloudinary.cloudName &&
      env.cloudinary.apiKey &&
      env.cloudinary.apiSecret
  );
}

export function isWebPushConfigured(): boolean {
  return Boolean(env.webPush.publicKey && env.webPush.privateKey && env.webPush.subject);
}

export function isLiveKitConfigured(): boolean {
  return Boolean(
    env.livekit.url &&
      /^wss?:\/\/|^https?:\/\//i.test(env.livekit.url) &&
      env.livekit.apiKey &&
      env.livekit.apiSecret
  );
}

export function isOtpProviderConfigured(): boolean {
  if (env.otp.provider === 'resend') {
    return Boolean(env.otp.resendApiKey && env.otp.emailFrom);
  }
  if (env.otp.provider === 'webhook') {
    return Boolean(env.otp.webhookUrl);
  }
  return Boolean(
    env.otp.twilioAccountSid &&
      env.otp.twilioAuthToken &&
      env.otp.twilioPhoneNumber
  );
}

export function getMissingOtpVars(): string[] {
  if (env.otp.provider === 'resend') {
    const missing: string[] = [];
    if (!env.otp.resendApiKey) missing.push('RESEND_API_KEY');
    if (!env.otp.emailFrom) missing.push('EMAIL_FROM');
    return missing;
  }
  if (env.otp.provider === 'webhook') {
    return env.otp.webhookUrl ? [] : ['OTP_WEBHOOK_URL'];
  }
  const missing: string[] = [];
  if (!env.otp.twilioAccountSid) missing.push('TWILIO_ACCOUNT_SID');
  if (!env.otp.twilioAuthToken) missing.push('TWILIO_AUTH_TOKEN');
  if (!env.otp.twilioPhoneNumber) missing.push('TWILIO_PHONE_NUMBER');
  return missing;
}

export function getServiceStatus() {
  return {
    database: env.mongodbUri ? 'configured' : 'local-fallback',
    cloudinary: isCloudinaryConfigured(),
    webPush: isWebPushConfigured(),
    livekit: isLiveKitConfigured(),
    otpProvider: isOtpProviderConfigured(),
    otpProviderType: env.otp.provider,
    missingOtpVars: getMissingOtpVars(),
    missingCloudinaryVars: isCloudinaryConfigured()
      ? []
      : ['CLOUDINARY_CLOUD_NAME', 'CLOUDINARY_API_KEY', 'CLOUDINARY_API_SECRET'],
  };
}
