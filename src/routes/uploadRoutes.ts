import { Router } from 'express';
import * as uploadController from '../controllers/uploadController';
import { requireAuth } from '../middleware/requireAuth';
import { uploadImageMiddleware } from '../middleware/upload';

export const uploadRouter = Router();

// Accepts a single multipart image file (field name "image"), stores it on local
// disk, and returns its public URL. The client then sets that URL on whichever
// resource references it (e.g. PUT /users/me/image), matching the existing
// URL-based imageUrl convention instead of storing binary data inline elsewhere.
uploadRouter.post('/image', requireAuth, uploadImageMiddleware, uploadController.uploadImage);
