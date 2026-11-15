import { Router } from 'express';
import {
  blockUser,
  getBlockedUsers,
  getMe,
  getMyQrCode,
  getPublicUserByUsername,
  getUserById,
  searchUsers,
  unblockUser,
  updateNotificationSettings,
  updatePrivacySettings,
  updateProfile,
} from '../controllers/userController.ts';
import { optionalAuth, requireAuth } from '../middleware/auth.ts';
import { asyncHandler } from '../utils/errors.ts';

const router = Router();

router.get('/public/:username', optionalAuth, asyncHandler(getPublicUserByUsername));

router.use(requireAuth);
router.get('/me', asyncHandler(getMe));
router.get('/me/qr', asyncHandler(getMyQrCode));
router.get('/blocked', asyncHandler(getBlockedUsers));
router.post('/block/:id', asyncHandler(blockUser));
router.delete('/block/:id', asyncHandler(unblockUser));
router.patch('/privacy', asyncHandler(updatePrivacySettings));
router.patch('/notifications', asyncHandler(updateNotificationSettings));
router.get('/search', asyncHandler(searchUsers));
router.get('/:id', asyncHandler(getUserById));
router.patch('/profile', asyncHandler(updateProfile));

export default router;
