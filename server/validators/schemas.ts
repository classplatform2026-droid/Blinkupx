import { z } from 'zod';

export const registerSchema = z.object({
  fullName: z.string().trim().min(2, 'Full name must be at least 2 characters').max(60),
  email: z.string().trim().toLowerCase().email('Enter a valid email address'),
  phone: z
    .string()
    .trim()
    .transform((v) => v.replace(/[\s\-()]/g, ''))
    .pipe(
      z
        .string()
        .regex(
          /^(?:01\d{9}|\+?(?:88)?01\d{9}|\+?[1-9]\d{6,14})$/,
          'Enter a valid phone number (e.g. 01900000000)'
        )
    ),
  username: z
    .string()
    .trim()
    .toLowerCase()
    .regex(/^[a-z0-9_]{3,24}$/, 'Username must be 3-24 characters using letters, numbers, or _'),
  password: z.string().min(8, 'Password must be at least 8 characters').max(128),
});

export const loginSchema = z.object({
  identifier: z.string().trim().min(2, 'Enter your phone number, email, or username'),
  password: z.string().min(1, 'Password is required'),
});

export const verifyOtpSchema = z.object({
  phone: z.string().trim().min(7, 'Phone number is required'),
  code: z.string().trim().regex(/^\d{6}$/, 'Enter the 6-digit verification code'),
  purpose: z.enum(['register', 'reset_password']).default('register'),
});

export const resendOtpSchema = z.object({
  phone: z.string().trim().min(2, 'Phone number, email, or username is required'),
  purpose: z.enum(['register', 'reset_password']).default('register'),
});

export const forgotPasswordSchema = z.object({
  phone: z.string().trim().min(2, 'Enter your registered phone number, email, or username'),
});

export const resetPasswordSchema = z
  .object({
    phone: z.string().trim().min(7, 'Phone number is required'),
    resetToken: z.string().trim().min(10).optional(),
    code: z
      .string()
      .trim()
      .regex(/^\d{6}$/, 'Enter the 6-digit verification code')
      .optional(),
    newPassword: z.string().min(8, 'Password must be at least 8 characters').max(128),
  })
  .refine((data) => Boolean(data.resetToken || data.code), {
    message: 'Verification code or reset token is required',
  });

export const privacyVisibilitySchema = z.enum(['everyone', 'contacts', 'nobody']);
export const soundToneSchema = z.enum(['chime', 'ping', 'pop', 'soft']);

export const privacySettingsSchema = z.object({
  lastSeen: privacyVisibilitySchema.optional(),
  onlineStatus: privacyVisibilitySchema.optional(),
  profilePhoto: privacyVisibilitySchema.optional(),
  about: privacyVisibilitySchema.optional(),
  readReceipts: z.boolean().optional(),
});

export const notificationSettingsSchema = z.object({
  pushEnabled: z.boolean().optional(),
  privateMessages: z.boolean().optional(),
  groupMessages: z.boolean().optional(),
  communityMessages: z.boolean().optional(),
  communityActivity: z.boolean().optional(),
  soundEnabled: z.boolean().optional(),
  soundTone: soundToneSchema.optional(),
  messagePreview: z.boolean().optional(),
  vibrationEnabled: z.boolean().optional(),
});

export const pushSubscribeSchema = z.object({
  subscription: z.object({
    endpoint: z
      .string()
      .trim()
      .url('Valid push subscription endpoint URL is required')
      .refine((url) => url.startsWith('https://'), {
        message: 'Push subscription endpoint must use HTTPS',
      }),
    expirationTime: z.number().nullable().optional(),
    keys: z.object({
      p256dh: z.string().trim().min(16, 'Valid p256dh key is required').max(512),
      auth: z.string().trim().min(8, 'Valid auth secret is required').max(256),
    }),
  }),
  deviceId: z.string().trim().max(128).optional().default(''),
  deviceLabel: z.string().trim().max(100).optional().default(''),
  enablePreference: z.boolean().optional().default(true),
});

export const pushUnsubscribeSchema = z.object({
  endpoint: z.string().trim().url().optional(),
  deviceId: z.string().trim().max(128).optional(),
  disablePreference: z.boolean().optional().default(false),
});

export const updateProfileSchema = z.object({
  fullName: z.string().trim().min(2).max(60).optional(),
  username: z
    .string()
    .trim()
    .toLowerCase()
    .regex(/^[a-z0-9_]{3,24}$/, 'Username must be 3-24 characters using letters, numbers, or _')
    .optional(),
  bio: z.string().trim().max(200).optional(),
  avatar: z.string().trim().max(500).optional(),
  settings: z
    .object({
      density: z.enum(['comfortable', 'compact']).optional(),
      enterToSend: z.boolean().optional(),
      readReceipts: z.boolean().optional(),
      typingIndicators: z.boolean().optional(),
      autoDownloadMedia: z.boolean().optional(),
      language: z.string().min(2).max(10).optional(),
      privacy: privacySettingsSchema.optional(),
      notifications: notificationSettingsSchema.optional(),
    })
    .optional(),
});

export const createConversationSchema = z.object({
  type: z.enum(['direct', 'group']),
  participantIds: z.array(z.string().min(1)).min(1),
  name: z.string().trim().min(2).max(80).optional(),
  avatar: z.string().trim().max(500).optional(),
});

export const sendMessageSchema = z.object({
  conversationId: z.string().min(1),
  clientMessageId: z.string().trim().min(1).max(120).optional().nullable(),
  content: z.string().max(5000).optional().default(''),
  messageType: z
    .enum(['text', 'image', 'video', 'document', 'voice'])
    .default('text'),
  attachments: z
    .array(
      z.object({
        url: z
          .string()
          .trim()
          .min(1)
          .refine(
            (val) => /^https?:\/\//i.test(val) || val.startsWith('/api/media/'),
            'Invalid attachment URL'
          ),
        publicId: z.string().optional().default(''),
        fileName: z.string().optional().default('attachment'),
        fileSize: z.number().optional().default(0),
        mimeType: z.string().optional().default(''),
        duration: z.number().optional().default(0),
        caption: z.string().trim().max(1000).optional().default(''),
      })
    )
    .max(10, 'Maximum 10 media attachments per message')
    .optional()
    .default([]),
  replyTo: z.string().nullable().optional(),
  forwardedFrom: z
    .object({
      messageId: z.string(),
      senderName: z.string(),
    })
    .nullable()
    .optional(),
});

export const editMessageSchema = z.object({
  content: z.string().trim().max(5000),
  attachmentCaptions: z
    .array(
      z.object({
        index: z.number().int().min(0).max(9),
        caption: z.string().trim().max(1000),
      })
    )
    .optional(),
});

export const reactionSchema = z.object({
  emoji: z.string().trim().min(1).max(16),
});

export const createCommunitySchema = z.object({
  name: z.string().trim().min(3, 'Community name must be at least 3 characters').max(60),
  description: z.string().trim().max(400).optional().default(''),
  image: z.string().trim().max(500).optional().default(''),
  privacy: z.enum(['public', 'private']).default('public'),
});

export const updateCommunitySettingsSchema = z.object({
  name: z
    .string()
    .trim()
    .min(3, 'Community name must be at least 3 characters')
    .max(60)
    .optional(),
  description: z.string().trim().max(400).optional(),
  image: z.string().trim().max(500).optional(),
  privacy: z.enum(['public', 'private']).optional(),
  settings: z
    .object({
      whoCanInvite: z
        .enum(['owner_only', 'admins', 'moderators', 'all_members'])
        .optional(),
      whoCanPinMessages: z.enum(['admins', 'moderators']).optional(),
      whoCanPost: z.enum(['all_members', 'moderators_only']).optional(),
    })
    .optional(),
});

export const inviteCommunityMembersSchema = z.object({
  userIds: z.array(z.string().min(1)).min(1, 'Select at least one user to invite').max(30),
});

export const handleJoinRequestSchema = z.object({
  targetUserId: z.string().min(1, 'Target user is required'),
  decision: z.enum(['approve', 'reject']),
});

export const transferOwnershipSchema = z.object({
  newOwnerId: z.string().min(1, 'New owner is required'),
});
