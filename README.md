# BlinkUpZ — MERN Messaging Web Application (V1.0)

**Connect. Communicate. Together.**

BlinkUpZ is a web-based real-time messaging application built on the MERN stack (MongoDB, Express.js, React, Node.js) with Socket.IO, JWT HTTP-only cookie authentication, bcrypt password hashing, and Cloudinary media storage.

## Features (V1.0)

- **Authentication (4 Screens)**: Welcome/Splash, Sign Up with live username uniqueness check, Login with Forgot Password recovery, and 6-digit SMS OTP verification.
- **Real-Time Messaging (4 Screens)**: Chats list with All/Unread/Groups/Archived filters, context actions (Pin, Mute, Archive, Delete), 1:1 & Group Message Screen with text, images, videos, documents, voice messages, replies, forwarding, editing, deletion, emoji reactions, typing indicators, online presence, and delivery/read receipts, New Chat & Group Creation, and Global Search.
- **Communities (3 Screens)**: Joined & Discover tabs, Public & Private community creation, role labels (`Owner`, `Admin`, `Moderator`, `Member`), join requests, pinned messages, and real-time group chat.
- **Calls (1 Screen)**: Call History view with All/Missed filters, call details, and entry removal (live voice/video calling is scheduled post-V1.0).
- **Profile & Settings (3 Screens)**: Profile overview, Edit Profile with avatar upload, and persistent App Settings.

## Environment Variables

Copy `.env.example` to `.env` and configure:

- `MONGODB_URI`: MongoDB connection string (falls back to local `mongodb-memory-server` if omitted in development).
- `JWT_SECRET`: Secret used to sign session JWTs.
- `CLOUDINARY_CLOUD_NAME`, `CLOUDINARY_API_KEY`, `CLOUDINARY_API_SECRET`: Required for profile, community, voice, and chat media uploads.
- `OTP_PROVIDER`: `"twilio"` or `"webhook"`.
  - For Twilio: `TWILIO_ACCOUNT_SID`, `TWILIO_AUTH_TOKEN`, `TWILIO_PHONE_NUMBER`
  - For Webhook: `OTP_WEBHOOK_URL`, `OTP_WEBHOOK_SECRET`

## Scripts

- `npm run dev` — Run Express + Socket.IO + Vite dev server on port 3000
- `npm run build` — Build frontend bundle into `dist/`
- `npm run start` — Run production server via `node server.ts`
- `npm run lint` — TypeScript check (`tsc --noEmit`)
