import { Types } from 'mongoose';

export interface DecodedMessageCursor {
  createdAt: Date;
  id?: Types.ObjectId;
}

export function encodeMessageCursor(createdAt: Date | string, id: string): string {
  const iso = new Date(createdAt).toISOString();
  return Buffer.from(`${iso}|${id}`, 'utf8').toString('base64url');
}

export function decodeMessageCursor(rawCursor: string): DecodedMessageCursor | null {
  const trimmed = rawCursor.trim();
  if (!trimmed) return null;

  // Try structured base64url compound cursor: "<isoTimestamp>|<objectId>"
  try {
    const decoded = Buffer.from(trimmed, 'base64url').toString('utf8');
    const sepIdx = decoded.indexOf('|');
    if (sepIdx > 0) {
      const isoPart = decoded.slice(0, sepIdx);
      const idPart = decoded.slice(sepIdx + 1);
      const parsedDate = new Date(isoPart);
      if (!Number.isNaN(parsedDate.getTime()) && Types.ObjectId.isValid(idPart)) {
        return {
          createdAt: parsedDate,
          id: new Types.ObjectId(idPart),
        };
      }
    }
  } catch {
    // Fall through to legacy ISO date cursor check
  }

  // Backward-compatible support for ISO timestamp strings in `before`
  if (/^\d{4}-\d{2}-\d{2}/.test(trimmed)) {
    const fallbackDate = new Date(trimmed);
    if (!Number.isNaN(fallbackDate.getTime())) {
      return { createdAt: fallbackDate };
    }
  }

  return null;
}
