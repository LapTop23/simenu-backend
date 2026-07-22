const mongoose = require('mongoose');

/**
 * Owner Schema — the login identity for a restaurant's account.
 *
 * Deliberately a SEPARATE collection from Restaurant, not fields bolted onto
 * it: authentication concerns (password hash, login attempts, session
 * bookkeeping) are a different lifecycle from the restaurant's own business
 * data, and keeping them apart means the Restaurant document (which the
 * public-profile endpoint partially exposes) can never accidentally leak
 * anything auth-related.
 *
 * IMPORTANT: `passwordHash` is exactly that — a one-way scrambled version of
 * the password, produced by bcrypt (see utils/passwordHash.js). The real,
 * original password is never stored anywhere, ever, not even temporarily.
 */
const ownerSchema = new mongoose.Schema(
  {
    email: {
      type: String,
      required: [true, 'An email is required.'],
      unique: true,
      trim: true,
      lowercase: true,
      match: [/^\S+@\S+\.\S+$/, 'Please provide a valid email address.'],
      index: true,
    },

    passwordHash: {
      type: String,
      required: true,
      select: false, // Excluded from queries by default — must be explicitly requested with .select('+passwordHash').
    },

    name: {
      type: String,
      trim: true,
      maxlength: 100,
      default: '',
    },

    // Every owner account belongs to exactly one restaurant. This is the
    // field every authorization check ultimately compares against
    // `req.tenant.id` (the DB-verified tenant from tenantResolver) — an
    // owner's token can only ever act on THIS restaurantId, never another.
    restaurantId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'Restaurant',
      required: true,
      unique: true, // One owner account per restaurant, for this version.
      index: true,
    },
  },
  {
    timestamps: true,
  }
);

module.exports = mongoose.model('Owner', ownerSchema);
