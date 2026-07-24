import fs from 'fs';
import path from 'path';
import { env } from './env';

/** Absolute path to the local disk directory where uploaded files are stored. */
export const UPLOAD_DIR_ABS = path.resolve(process.cwd(), env.UPLOAD_DIR);

fs.mkdirSync(UPLOAD_DIR_ABS, { recursive: true });
