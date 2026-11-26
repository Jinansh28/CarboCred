/**
 * backend/src/models/EntityProfile.js
 *
 * Mongoose schema for mapping hashed account IDs to business names.
 */

import mongoose from 'mongoose';

const EntityProfileSchema = new mongoose.Schema({
    accountId: {
        type: String,
        required: true,
        unique: true,
        index: true,
        trim: true,
    },
    businessName: {
        type: String,
        required: true,
        trim: true,
        minlength: 2,
        maxlength: 100,
    }
}, {
    timestamps: true // Adds createdAt and updatedAt automatically
});

export default mongoose.model('EntityProfile', EntityProfileSchema);
