import { Router } from 'express';
import {
  createConversation,
  deleteConversation,
  getConversation,
  getSharedMedia,
  listConversations,
  markAllAsRead,
  updateConversationMeta,
} from '../controllers/conversationController.ts';
import { requireAuth } from '../middleware/auth.ts';
import { asyncHandler } from '../utils/errors.ts';

const router = Router();

router.use(requireAuth);
router.get('/', asyncHandler(listConversations));
router.post('/', asyncHandler(createConversation));
router.post('/mark-all-read', asyncHandler(markAllAsRead));
router.get('/:id/shared-media', asyncHandler(getSharedMedia));
router.get('/:id', asyncHandler(getConversation));
router.patch('/:id', asyncHandler(updateConversationMeta));
router.delete('/:id', asyncHandler(deleteConversation));

export default router;
