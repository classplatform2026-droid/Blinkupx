import { Router } from 'express';
import {
  getMyPushSubscriptions,
  getVapidPublicKey,
  removePushSubscriptionById,
  subscribePush,
  unsubscribePush,
  updatePushPreferences,
} from '../controllers/pushController.ts';
import { requireAuth } from '../middleware/auth.ts';
import { asyncHandler } from '../utils/errors.ts';

const router = Router();

router.use(requireAuth);

router.get('/vapid-public-key', asyncHandler(getVapidPublicKey));
router.get('/subscriptions', asyncHandler(getMyPushSubscriptions));
router.post('/subscribe', asyncHandler(subscribePush));
router.post('/unsubscribe', asyncHandler(unsubscribePush));
router.delete('/subscribe', asyncHandler(unsubscribePush));
router.delete('/subscriptions/:id', asyncHandler(removePushSubscriptionById));
router.patch('/preferences', asyncHandler(updatePushPreferences));

export default router;
