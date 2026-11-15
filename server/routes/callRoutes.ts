import { Router } from 'express';
import {
  deleteCallEntry,
  listCallHistory,
} from '../controllers/callController.ts';
import { requireAuth } from '../middleware/auth.ts';
import { asyncHandler } from '../utils/errors.ts';

const router = Router();

router.use(requireAuth);
router.get('/history', asyncHandler(listCallHistory));
router.delete('/:id', asyncHandler(deleteCallEntry));

export default router;
