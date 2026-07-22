const mongoose = require('mongoose');

/**
 * Restaurant Schema — represents a single SaaS tenant.
 *
 * Every other tenant-owned collection (MenuItem, Order) stores a `restaurantId`
 * that references this document's `_id`. This is the root of the multi-tenant
 * data model: no MenuItem or Order can exist without a valid, active Restaurant.
 */
const restaurantSchema = new mongoose.Schema(
  {
    // Public, URL-safe tenant identifier used in customer-facing links, e.g.
    // https://simenu.app/menu?res=savory-foods — never expose the raw Mongo _id
    // in QR codes/URLs, since sequential/guessable identifiers invite enumeration attempts.
    slug: {
      type: String,
      required: [true, 'A restaurant slug is required.'],
      unique: true,
      trim: true,
      lowercase: true,
      minlength: [3, 'Slug must be at least 3 characters long.'],
      maxlength: [60, 'Slug cannot exceed 60 characters.'],
      match: [
        /^[a-z0-9]+(?:-[a-z0-9]+)*$/,
        'Slug may only contain lowercase letters, numbers, and single hyphens (e.g. "savory-foods").',
      ],
      index: true,
    },

    name: {
      type: String,
      required: [true, 'Restaurant name is required.'],
      trim: true,
      maxlength: [100, 'Restaurant name cannot exceed 100 characters.'],
    },

    // Branding — powers white-label theming of the customer-facing digital menu.
    branding: {
      logoUrl: { type: String, trim: true, default: null },
      coverImageUrl: { type: String, trim: true, default: null },
      primaryColor: {
        type: String,
        trim: true,
        default: '#0F172A',
        match: [/^#([0-9A-Fa-f]{3}){1,2}$/, 'primaryColor must be a valid hex color code.'],
      },
      secondaryColor: {
        type: String,
        trim: true,
        default: '#F59E0B',
        match: [/^#([0-9A-Fa-f]{3}){1,2}$/, 'secondaryColor must be a valid hex color code.'],
      },
      tagline: { type: String, trim: true, maxlength: 150, default: '' },
    },

    // Operational configuration — tenant-level toggles and business rules.
    config: {
      currency: { type: String, trim: true, default: 'PKR', uppercase: true, maxlength: 3 },
      taxPercentage: { type: Number, default: 0, min: 0, max: 100 },
      timezone: { type: String, trim: true, default: 'Asia/Karachi' },
      tableCount: { type: Number, default: 10, min: 0 },
      acceptsOnlineOrders: { type: Boolean, default: true },
      acceptsDigitalPayments: { type: Boolean, default: true },
      // Master kill-switch — an inactive tenant is invisible to all public APIs,
      // even though its data remains intact (used for suspended/unpaid SaaS accounts).
      isActive: { type: Boolean, default: true, index: true },
    },

    contact: {
      email: {
        type: String,
        trim: true,
        lowercase: true,
        match: [/^\S+@\S+\.\S+$/, 'Please provide a valid contact email.'],
      },
      phone: { type: String, trim: true },
      address: { type: String, trim: true, maxlength: 250 },
    },
  },
  {
    timestamps: true, // createdAt / updatedAt, useful for SaaS billing-cycle and onboarding-date tracking.
  }
);

// Compound index supporting the most common lookup pattern: "find the active tenant by slug".
restaurantSchema.index({ slug: 1, 'config.isActive': 1 });

module.exports = mongoose.model('Restaurant', restaurantSchema);
