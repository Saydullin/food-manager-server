import { Router } from 'express';
import * as uploadController from '../../controllers/uploadController';
import { requireAdmin } from '../../middleware/requireAdmin';
import { uploadImageMiddleware } from '../../middleware/upload';

export const adminUploadRouter = Router();

// Same controller/storage as the mobile-facing /uploads/image — it only reads
// req.file, never req.auth — just gated by requireAdmin instead of requireAuth
// since the admin panel authenticates with an admin token, not a user token.
adminUploadRouter.post('/image', requireAdmin, uploadImageMiddleware, uploadController.uploadImage);
