import { Router } from 'express';
import {
  cancelJoinRequest,
  createCommunity,
  deleteCommunity,
  getCommunity,
  handleJoinRequest,
  inviteMembers,
  joinCommunity,
  leaveCommunity,
  listCommunities,
  listCommunityMembers,
  removeMember,
  transferOwnership,
  updateCommunitySettings,
  updateMemberRole,
} from '../controllers/communityController.ts';
import { requireAuth } from '../middleware/auth.ts';
import { asyncHandler } from '../utils/errors.ts';

const router = Router();

router.use(requireAuth);
router.get('/', asyncHandler(listCommunities));
router.post('/', asyncHandler(createCommunity));
router.get('/:id', asyncHandler(getCommunity));
router.delete('/:id', asyncHandler(deleteCommunity));
router.get('/:id/members', asyncHandler(listCommunityMembers));
router.post('/:id/invite', asyncHandler(inviteMembers));
router.post('/:id/join', asyncHandler(joinCommunity));
router.delete('/:id/join-request', asyncHandler(cancelJoinRequest));
router.post('/:id/leave', asyncHandler(leaveCommunity));
router.post('/:id/requests', asyncHandler(handleJoinRequest));
router.patch('/:id/settings', asyncHandler(updateCommunitySettings));
router.post('/:id/transfer-ownership', asyncHandler(transferOwnership));
router.patch('/:id/members/:memberId', asyncHandler(updateMemberRole));
router.delete('/:id/members/:memberId', asyncHandler(removeMember));

export default router;
