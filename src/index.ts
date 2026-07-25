import cors from 'cors';
import express from 'express';
import { env } from './config/env';
import { UPLOAD_DIR_ABS } from './config/upload';
import { seedDefaultAdmin } from './config/seedAdmin';
import { apiRouter } from './routes';
import { errorHandler, notFoundHandler } from './middleware/errorHandler';

const app = express();

app.use(cors({ origin: env.CORS_ORIGIN === '*' ? true : env.CORS_ORIGIN.split(',') }));
app.use(express.json());

app.get('/health', (_req, res) => {
  res.status(200).json({ status: 'ok' });
});

// Serves files uploaded via POST /api/uploads/image. Filenames are random UUIDs
// generated server-side (see middleware/upload.ts) and never reused, so a long,
// immutable cache lifetime is safe.
app.use('/uploads', express.static(UPLOAD_DIR_ABS, { maxAge: '7d', immutable: true }));

app.use('/api', apiRouter);

app.use(notFoundHandler);
app.use(errorHandler);

seedDefaultAdmin()
  .catch((err) => console.error('[seedAdmin] failed to seed default admin', err))
  .finally(() => {
    app.listen(env.PORT, () => {
      console.log(`[server] listening on http://localhost:${env.PORT}`);
    });
  });
