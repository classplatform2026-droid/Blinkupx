import { Router } from 'express';
import multer from 'multer';
import {
  accessLocalMedia,
  downloadAttachment,
  globalSearch,
  uploadMedia,
} from '../controllers/searchMediaController.ts';
import { requireAuth } from '../middleware/auth.ts';
import { ALLOWED_MIME_TYPES, MAX_UPLOAD_BYTES } from '../services/mediaService.ts';
import { AppError, asyncHandler } from '../utils/errors.ts';

const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: MAX_UPLOAD_BYTES },
  fileFilter: (_req, file, cb) => {
    if (!ALLOWED_MIME_TYPES.has(file.mimetype)) {
      return cb(new AppError(`Unsupported file type: ${file.mimetype}`, 400, 'UNSUPPORTED_FILE_TYPE'));
    }
    cb(null, true);
  },
});

const router = Router();

router.get('/media/access/:fileId', asyncHandler(accessLocalMedia));

router.use(requireAuth);
router.get('/search', asyncHandler(globalSearch));
router.post('/media/upload', upload.single('file'), asyncHandler(uploadMedia));
router.get(
  '/media/download/:messageId/:attachmentIndex',
  asyncHandler(downloadAttachment)
);

export default router;
