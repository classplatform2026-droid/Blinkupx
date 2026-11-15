import { Router } from 'express';
import {
  deleteMessage,
  editMessage,
  getMessagesAround,
  listMessages,
  sendMessage,
  toggleReaction,
} from '../controllers/messageController.ts';
import { requireAuth } from '../middleware/auth.ts';
import { asyncHandler } from '../utils/errors.ts';

const router = Router();

router.use(requireAuth);
router.get('/:conversationId/around/:messageId', asyncHandler(getMessagesAround));
router.get('/:conversationId', asyncHandler(listMessages));
router.post('/', asyncHandler(sendMessage));
router.patch('/:id', asyncHandler(editMessage));
router.delete('/:id', asyncHandler(deleteMessage));
router.post('/:id/reactions', asyncHandler(toggleReaction));

export default router;
