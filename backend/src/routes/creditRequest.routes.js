/**
 * routes/creditRequest.routes.js
 *
 * All routes are JWT-protected:
 *   POST   /api/requests             — authenticated users only
 *   GET    /api/requests/mine        — authenticated users (own requests)
 *   GET    /api/requests/pending     — admin only
 *   POST   /api/requests/:id/approve — admin only (atomic PENDING -> PROCESSING lock)
 *   POST   /api/requests/:id/reject  — admin only (atomic PENDING -> REJECTED)
 */

import express from 'express';
import mongoose from 'mongoose';
import { ethers } from 'ethers';
import CreditRequest from '../models/CreditRequest.js';
import { awardCredits, recordDebt } from '../../signer.js';
import requireAuth from '../middleware/requireAuth.js';
import requireAdmin from '../middleware/requireAdmin.js';

const PRE_BROADCAST_CODES = new Set([
    'INVALID_ARGUMENT',
    'MISSING_ARGUMENT',
    'UNEXPECTED_ARGUMENT',
    'INSUFFICIENT_FUNDS',
    'NONCE_EXPIRED',
    'CONFIG_ERROR',
]);

function parsePositiveSafeInteger(rawAmount) {
    if (typeof rawAmount === 'number') {
        return Number.isSafeInteger(rawAmount) && rawAmount >= 1 ? rawAmount : null;
    }
    if (typeof rawAmount === 'string') {
        const trimmed = rawAmount.trim();
        if (!/^\d+$/.test(trimmed)) return null;
        const parsed = Number(trimmed);
        return Number.isSafeInteger(parsed) && parsed >= 1 ? parsed : null;
    }
    return null;
}

function isPreBroadcastError(err) {
    if (!err) return false;
    if (err.preBroadcast === true) return true;
    // Any receipt or tx hash indicates the transaction was broadcast
    if (err.receipt || err.transactionHash || err.hash) return false;
    if (PRE_BROADCAST_CODES.has(err.code)) return true;
    // Revert during static eth_estimateGas / preflight before broadcast
    if (err.code === 'CALL_EXCEPTION') return true;
    if (typeof err.message === 'string' && err.message.includes('environment variable is required')) {
        return true;
    }
    return false;
}

export function createCreditRequestRouter({
    CreditRequestModel = CreditRequest,
    awardCreditsFn = awardCredits,
    recordDebtFn = recordDebt,
} = {}) {
    const router = express.Router();

    // ── POST /api/requests ────────────────────────────────────────────────────
    // Authenticated users submit a PENDING request.
    router.post('/', requireAuth, async (req, res) => {
        try {
            const { entityAddress, type, amount, reason } = req.body;

            if (!entityAddress || !type || amount === undefined || amount === null || !reason) {
                return res.status(400).json({
                    success: false,
                    error: 'entityAddress, type, amount, and reason are required.',
                });
            }
            if (!ethers.isAddress(entityAddress)) {
                return res.status(400).json({ success: false, error: 'Invalid Ethereum address.' });
            }
            if (!['CREDIT', 'DEBT'].includes(type)) {
                return res.status(400).json({ success: false, error: "type must be 'CREDIT' or 'DEBT'." });
            }
            if (typeof reason !== 'string' || !reason.trim()) {
                return res.status(400).json({ success: false, error: 'reason must be a non-empty string.' });
            }

            const parsedAmount = parsePositiveSafeInteger(amount);
            if (parsedAmount === null) {
                return res.status(400).json({
                    success: false,
                    error: 'amount must be a positive safe integer >= 1.',
                });
            }

            const request = await CreditRequestModel.create({
                entityAddress: entityAddress.toLowerCase(),
                type,
                amount: parsedAmount,
                reason: reason.trim(),
                submittedBy: req.user._id,
            });

            console.log(`[Requests] New ${type} request from ${entityAddress}: ${parsedAmount} → ID ${request._id}`);
            res.status(201).json({ success: true, requestId: request._id });
        } catch (err) {
            console.error('[Requests] POST / error:', err.message);
            res.status(500).json({ success: false, error: err.message });
        }
    });

    // ── GET /api/requests/mine ────────────────────────────────────────────────
    // Authenticated user — list own submitted requests (paginated).
    router.get('/mine', requireAuth, async (req, res) => {
        try {
            const rawPage = Number.parseInt(req.query.page, 10);
            const rawLimit = Number.parseInt(req.query.limit, 10);
            const page = Number.isFinite(rawPage) && rawPage >= 1 ? rawPage : 1;
            const limit = Number.isFinite(rawLimit) && rawLimit >= 1 ? Math.min(rawLimit, 50) : 20;
            const skip = (page - 1) * limit;

            const filter = { submittedBy: req.user._id };
            const [requests, total] = await Promise.all([
                CreditRequestModel.find(filter)
                    .sort({ createdAt: -1 })
                    .skip(skip)
                    .limit(limit)
                    .lean(),
                CreditRequestModel.countDocuments(filter),
            ]);

            res.json({ success: true, requests, page, limit, total });
        } catch (err) {
            console.error('[Requests] GET /mine error:', err.message);
            res.status(500).json({ success: false, error: err.message });
        }
    });

    // ── GET /api/requests/pending ─────────────────────────────────────────────
    // Admin only — list PENDING requests.
    router.get('/pending', requireAuth, requireAdmin, async (req, res) => {
        try {
            const requests = await CreditRequestModel.find({ status: 'PENDING' })
                .sort({ createdAt: -1 })
                .lean();
            res.json({ success: true, requests });
        } catch (err) {
            console.error('[Requests] GET /pending error:', err.message);
            res.status(500).json({ success: false, error: err.message });
        }
    });

    // ── POST /api/requests/:id/approve ────────────────────────────────────────
    // Admin only — atomically claim PENDING -> PROCESSING and mint/record on-chain.
    router.post('/:id/approve', requireAuth, requireAdmin, async (req, res) => {
        if (!mongoose.isValidObjectId(req.params.id)) {
            return res.status(400).json({ success: false, error: 'Invalid request ID.' });
        }

        let lockedRequest;
        try {
            lockedRequest = await CreditRequestModel.findOneAndUpdate(
                { _id: req.params.id, status: 'PENDING' },
                {
                    $set: {
                        status: 'PROCESSING',
                        reviewedBy: req.user._id,
                        reviewedAt: new Date(),
                    },
                },
                { new: true }
            );

            if (!lockedRequest) {
                const existing = await CreditRequestModel.findById(req.params.id);
                if (!existing) {
                    return res.status(404).json({ success: false, error: 'Request not found.' });
                }
                return res.status(409).json({
                    success: false,
                    error: `Cannot approve — already ${existing.status}.`,
                });
            }
        } catch (err) {
            console.error('[Requests] POST /:id/approve lock error:', err.message);
            return res.status(500).json({ success: false, error: err.message });
        }

        try {
            console.log(`[Requests] Approving ${lockedRequest.type} for ${lockedRequest.entityAddress}: ${lockedRequest.amount}`);

            const receipt = lockedRequest.type === 'CREDIT'
                ? await awardCreditsFn(lockedRequest.entityAddress, BigInt(lockedRequest.amount), lockedRequest.reason)
                : await recordDebtFn(lockedRequest.entityAddress, BigInt(lockedRequest.amount), lockedRequest.reason);

            await CreditRequestModel.findOneAndUpdate(
                { _id: lockedRequest._id, status: 'PROCESSING' },
                {
                    $set: {
                        status: 'APPROVED',
                        txHash: receipt.hash,
                        reviewedAt: new Date(),
                    },
                },
                { new: true }
            );

            console.log(`[Requests] ✅ Approved. txHash: ${receipt.hash}`);
            return res.json({ success: true, txHash: receipt.hash, requestId: lockedRequest._id });
        } catch (txErr) {
            console.error('[Requests] POST /:id/approve tx error:', txErr.message);

            try {
                if (isPreBroadcastError(txErr)) {
                    await CreditRequestModel.findOneAndUpdate(
                        { _id: lockedRequest._id, status: 'PROCESSING' },
                        {
                            $set: {
                                status: 'PENDING',
                                reviewedBy: null,
                                reviewedAt: null,
                            },
                        }
                    );
                } else {
                    await CreditRequestModel.findOneAndUpdate(
                        { _id: lockedRequest._id, status: 'PROCESSING' },
                        {
                            $set: {
                                status: 'FAILED',
                                reviewedAt: new Date(),
                            },
                        }
                    );
                }
            } catch (recoveryErr) {
                console.error('[Requests] POST /:id/approve recovery error:', recoveryErr.message);
            }

            return res.status(500).json({ success: false, error: txErr.message });
        }
    });

    // ── POST /api/requests/:id/reject ─────────────────────────────────────────
    // Admin only — atomically reject without on-chain action.
    router.post('/:id/reject', requireAuth, requireAdmin, async (req, res) => {
        if (!mongoose.isValidObjectId(req.params.id)) {
            return res.status(400).json({ success: false, error: 'Invalid request ID.' });
        }

        try {
            const rawReason = req.body?.rejectionReason ?? req.body?.reason;
            const rejectionReason = typeof rawReason === 'string' && rawReason.trim()
                ? rawReason.trim().slice(0, 500)
                : null;

            const request = await CreditRequestModel.findOneAndUpdate(
                { _id: req.params.id, status: 'PENDING' },
                {
                    $set: {
                        status: 'REJECTED',
                        reviewedBy: req.user._id,
                        reviewedAt: new Date(),
                        rejectionReason,
                    },
                },
                { new: true }
            );

            if (!request) {
                const existing = await CreditRequestModel.findById(req.params.id);
                if (!existing) {
                    return res.status(404).json({ success: false, error: 'Request not found.' });
                }
                return res.status(409).json({
                    success: false,
                    error: `Cannot reject — already ${existing.status}.`,
                });
            }

            console.log(`[Requests] ❌ Rejected ${request._id}`);
            return res.json({ success: true, requestId: request._id });
        } catch (err) {
            console.error('[Requests] POST /:id/reject error:', err.message);
            return res.status(500).json({ success: false, error: err.message });
        }
    });

    return router;
}

export default createCreditRequestRouter();
