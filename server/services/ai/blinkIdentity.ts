import { Types } from 'mongoose';

export const BLINK_AI_SENDER_ID = '626c696e6b61690000000001';
export const BLINK_AI_SENDER_OBJECT_ID = new Types.ObjectId(BLINK_AI_SENDER_ID);
export const BLINK_AI_DISPLAY_NAME = 'Blink';
export const BLINK_AI_USERNAME = 'blink';

export const BLINK_AI_SERIALIZED_SENDER = {
  id: BLINK_AI_SENDER_ID,
  fullName: BLINK_AI_DISPLAY_NAME,
  username: BLINK_AI_USERNAME,
  avatar: '',
  isAi: true,
};

export function isAiMessageLike(msg: {
  senderType?: string | null;
  senderId?: unknown;
}): boolean {
  if (msg.senderType === 'ai') return true;
  if (typeof msg.senderId === 'string' && msg.senderId === BLINK_AI_SENDER_ID) {
    return true;
  }
  if (
    msg.senderId &&
    typeof msg.senderId === 'object' &&
    'toString' in msg.senderId &&
    typeof (msg.senderId as { toString(): string }).toString === 'function'
  ) {
    return (msg.senderId as { toString(): string }).toString() === BLINK_AI_SENDER_ID;
  }
  return false;
}
