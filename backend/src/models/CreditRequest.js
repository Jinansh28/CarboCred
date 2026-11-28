/**
 * models/CreditRequest.js
 *
 * Represents a user's request to earn carbon credits or record debt.
 * Requests begin as PENDING and are minted on-chain only after
 * an admin explicitly approves them via the dashboard.
 */

import mongoose from 'mongoose';

const CreditRequestSchema = new mongoose.Schema(
    {
        entityAddress: {
            type: String,
            required: true,
            lowercase: true,
            trim: true,
        },
        type: {
            type: String,
            enum: ['CREDIT', 'DEBT'],
            required: true,
        },
        amount: {
            type: Number,
            required: true,
            min: 1,
        },
        reason: {
            type: String,
            required: true,
            trim: true,
            maxlength: 500,
        },
        status: {
            type: String,
            enum: ['PENDING', 'PROCESSING', 'APPROVED', 'REJECTED', 'FAILED'],
            default: 'PENDING',
        },
        submittedBy: {
            type: mongoose.Schema.Types.ObjectId,
            ref: 'User',
            default: null,
        },
        reviewedBy: {
            type: mongoose.Schema.Types.ObjectId,
            ref: 'User',
            default: null,
        },
        reviewedAt: {
            type: Date,
            default: null,
        },
        rejectionReason: {
            type: String,
            trim: true,
            maxlength: 500,
            default: null,
        },
        txHash: {
            type: String,
            default: null,
        },
    },
    { timestamps: true }   // adds createdAt + updatedAt automatically
);

// Indexes for pending queue, entity history, and user submissions
CreditRequestSchema.index({ status: 1, createdAt: -1 });
CreditRequestSchema.index({ entityAddress: 1, createdAt: -1 });
CreditRequestSchema.index({ submittedBy: 1, createdAt: -1 });

export default mongoose.model('CreditRequest', CreditRequestSchema);
