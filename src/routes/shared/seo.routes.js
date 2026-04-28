// server/src/routes/shared/seo.routes.js
//
// SEO endpoints exposed at the API root (NOT under /api) so search engines
// can fetch them at the canonical paths /sitemap.xml and /robots.txt when
// served through the deployment's rewrite rules (see client/vercel.json).
//
// These routes are mounted directly on the Express app (see server/app.js)
// to bypass the /api prefix, rate limiter, and auth middleware.

import express from 'express';
import { getSitemap, getRobots } from '../../controllers/seoController.js';

const router = express.Router();

router.get('/sitemap.xml', getSitemap);
router.get('/robots.txt', getRobots);

export default router;
