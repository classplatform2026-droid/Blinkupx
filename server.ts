import http from 'node:http';
import path from 'node:path';
import cookieParser from 'cookie-parser';
import cors from 'cors';
import express from 'express';
import helmet from 'helmet';
import mongoose from 'mongoose';
import { connectDatabase } from './server/config/db.ts';
import { env, getServiceStatus, validateAiStartupConfig } from './server/config/env.ts';
import { apiRateLimiter } from './server/middleware/rateLimit.ts';
import { sanitizeRequest } from './server/middleware/sanitize.ts';
import authRoutes from './server/routes/authRoutes.ts';
import callRoutes from './server/routes/callRoutes.ts';
import communityRoutes from './server/routes/communityRoutes.ts';
import conversationRoutes from './server/routes/conversationRoutes.ts';
import messageRoutes from './server/routes/messageRoutes.ts';
import pushRoutes from './server/routes/pushRoutes.ts';
import searchMediaRoutes from './server/routes/searchMediaRoutes.ts';
import userRoutes from './server/routes/userRoutes.ts';
import { initSocketServer } from './server/sockets/index.ts';
import { errorMiddleware } from './server/utils/errors.ts';

async function bootstrap() {
  const app = express();
  app.set('trust proxy', 1);

  const httpServer = http.createServer(app);
  initSocketServer(httpServer);

  if (env.isProd) {
    app.use((req, res, next) => {
      const proto = req.headers['x-forwarded-proto'];
      const host = req.headers.host || '';
      const isLocalHost =
        host.startsWith('localhost') || host.startsWith('127.0.0.1');
      if (proto === 'http' && host && !isLocalHost) {
        return res.redirect(301, `https://${host}${req.originalUrl}`);
      }
      next();
    });
  }

  app.use(
    helmet({
      contentSecurityPolicy: false,
      crossOriginEmbedderPolicy: false,
    })
  );

  app.use(
    cors({
      origin: true,
      credentials: true,
    })
  );

  app.use(cookieParser());
  app.use(express.json({ limit: '2mb' }));
  app.use(express.urlencoded({ extended: true, limit: '2mb' }));
  app.use(sanitizeRequest);

  app.get('/api/health', (_req, res) => {
    res.json({
      success: true,
      status: 'ok',
      dbConnected: mongoose.connection.readyState === 1,
      services: getServiceStatus(),
    });
  });

  // Ensure DB is connected before serving API requests
  app.use('/api', apiRateLimiter, async (_req, _res, next) => {
    try {
      await connectDatabase();
      next();
    } catch (err) {
      next(err);
    }
  });

  app.use('/api/auth', authRoutes);
  app.use('/api/users', userRoutes);
  app.use('/api/conversations', conversationRoutes);
  app.use('/api/messages', messageRoutes);
  app.use('/api/communities', communityRoutes);
  app.use('/api/calls', callRoutes);
  app.use('/api/push', pushRoutes);
  app.use('/api', searchMediaRoutes);

  app.use('/api', errorMiddleware);

  if (!env.isProd) {
    const { createServer: createViteServer } = await import('vite');
    const vite = await createViteServer({
      server: { middlewareMode: true },
      appType: 'spa',
    });
    app.use('/sw.js', (_req, res, next) => {
      res.setHeader('Cache-Control', 'no-cache, no-store, must-revalidate');
      next();
    });
    app.use(vite.middlewares);
  } else {
    const distDir = path.resolve(process.cwd(), 'dist');
    app.use(
      express.static(distDir, {
        etag: true,
        setHeaders: (res, filePath) => {
          const normalized = filePath.replace(/\\/g, '/');
          if (normalized.endsWith('/sw.js') || normalized.endsWith('/index.html')) {
            res.setHeader('Cache-Control', 'no-cache, no-store, must-revalidate');
          } else if (normalized.endsWith('.webmanifest')) {
            res.setHeader('Content-Type', 'application/manifest+json; charset=utf-8');
            res.setHeader('Cache-Control', 'no-cache');
          } else if (normalized.includes('/assets/')) {
            res.setHeader('Cache-Control', 'public, max-age=31536000, immutable');
          } else {
            res.setHeader('Cache-Control', 'public, max-age=3600');
          }
        },
      })
    );
    app.get('*', (_req, res) => {
      res.setHeader('Cache-Control', 'no-cache, no-store, must-revalidate');
      res.sendFile(path.join(distDir, 'index.html'));
    });
  }

  // Start HTTP server immediately on port 3000, connect MongoDB in parallel
  httpServer.listen(env.port, '0.0.0.0', () => {
    console.log(`[BlinkUpZ] Server listening on http://0.0.0.0:${env.port}`);
    validateAiStartupConfig();
  });

  connectDatabase().catch((err) => {
    console.error('[DB] Initial MongoDB connection failed:', err);
  });
}

bootstrap().catch((err) => {
  console.error('[BlinkUpZ] Fatal startup error:', err);
  process.exit(1);
});
