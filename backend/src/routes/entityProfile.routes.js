/**
 * backend/src/routes/entityProfile.routes.js
 *
 * Routes for business identity profiles.
 */

import express from 'express';
import { getProfile, upsertProfile } from '../controllers/entityProfile.controller.js';

const router = express.Router();

// GET /entity/profile/:accountId
router.get('/profile/:accountId', getProfile);

// POST /entity/profile
router.post('/profile', upsertProfile);

export default router;
