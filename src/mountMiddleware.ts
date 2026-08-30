import cors from 'cors';
import express from 'express';
import handleJsonParseError from './middlewares/handleJsonParseError';

export default function mountMiddleware(app: express.Application) {
  app.use(cors({ maxAge: 86400 }));
  app.use(express.json({ limit: '4mb' }));
  app.use(express.urlencoded({ limit: '4mb', extended: false }));
  app.use(handleJsonParseError);
}
