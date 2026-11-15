import { Router } from 'express';
import {
  createCommunity,
  getCommunity,
  handleJoinRequest,
  joinCommunity,
  leaveCommunity,
  listCommunities,
  updateMemberRole,
} from '../controllers/communityController.ts';
import { requireAuth } from '../middleware/auth.ts';
import { asyncHandler } from '../utils/errors.ts';

const router = Router();

router.use(requireAuth);
router.get('/', asyncHandler(listCommunities));
router.post('/', asyncHandler(createCommunity));
router.get('/:id', asyncHandler(getCommunity));
router.post('/:id/join', asyncHandler(joinCommunity));
router.post('/:id/leave', asyncHandler(leaveCommunity));
router.post('/:id/requests', asyncHandler(handleJoinRequest));
router.patch('/:id/members/:memberId', asyncHandler(updateMemberRole));

export default router;
