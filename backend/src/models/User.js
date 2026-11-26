/**
 * models/User.js
 * Stores registered users. Role determines access level.
 */

import mongoose from 'mongoose';
import bcrypt from 'bcryptjs';

const UserSchema = new mongoose.Schema(
    {
        email: {
            type: String,
            required: true,
            unique: true,
            lowercase: true,
            trim: true,
        },
        password: {
            type: String,
            required: true,
            minlength: 6,
            select: false,   // never returned in queries by default
        },
        role: {
            type: String,
            enum: ['USER', 'ADMIN'],
            default: 'USER',
        },
    },
    { timestamps: true }
);

// Hash password before saving (Mongoose 9+: async hooks don't use next())
UserSchema.pre('save', async function () {
    if (!this.isModified('password')) return;
    this.password = await bcrypt.hash(this.password, 12);
});

// Compare plain-text password with stored hash
UserSchema.methods.comparePassword = async function (plain) {
    return bcrypt.compare(plain, this.password);
};

export default mongoose.model('User', UserSchema);
