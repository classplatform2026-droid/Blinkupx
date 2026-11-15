import { Router } from 'express';
import {
  getMe,
  getMyQrCode,
  getPublicUserByUsername,
  getUserById,
  searchUsers,
  updateProfile,
} from '../controllers/userController.ts';
import { requireAuth } from '../middleware/auth.ts';
import { asyncHandler } from '../utils/errors.ts';

const router = Router();

router.get('/public/:username', asyncHandler(getPublicUserByUsername));

router.use(requireAuth);
router.get('/me', asyncHandler(getMe));
router.get('/me/qr', asyncHandler(getMyQrCode));
router.get('/search', asyncHandler(searchUsers));
router.get('/:id', asyncHandler(getUserById));
router.patch('/profile', asyncHandler(updateProfile));

export default router;
