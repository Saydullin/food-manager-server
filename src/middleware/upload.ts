import { randomUUID } from 'crypto';
import multer from 'multer';
import { env } from '../config/env';
import { UPLOAD_DIR_ABS } from '../config/upload';
import { AppError } from '../utils/errors';

// Only accept image types we know how to serve safely. The stored filename's
// extension is derived from this whitelist rather than the client-supplied
// filename, so a malicious filename can't smuggle in a path or odd extension.
const IMAGE_MIME_EXTENSIONS: Record<string, string> = {
  'image/jpeg': '.jpg',
  'image/png': '.png',
  'image/webp': '.webp',
  'image/gif': '.gif',
};

const storage = multer.diskStorage({
  destination: (_req, _file, cb) => cb(null, UPLOAD_DIR_ABS),
  filename: (_req, file, cb) => cb(null, `${randomUUID()}${IMAGE_MIME_EXTENSIONS[file.mimetype]}`),
});

const fileFilter: multer.Options['fileFilter'] = (_req, file, cb) => {
  if (!IMAGE_MIME_EXTENSIONS[file.mimetype]) {
    cb(AppError.badRequest(`Unsupported image type: ${file.mimetype}`, 'UNSUPPORTED_IMAGE_TYPE'));
    return;
  }
  cb(null, true);
};

/** Handles `POST /uploads/image`: a single multipart field named "image". */
export const uploadImageMiddleware = multer({
  storage,
  fileFilter,
  limits: { fileSize: env.UPLOAD_MAX_FILE_SIZE_MB * 1024 * 1024, files: 1 },
}).single('image');
