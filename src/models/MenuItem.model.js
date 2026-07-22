const mongoose = require('mongoose');

/**
 * Modifier Option Sub-Schema — a single selectable choice within a modifier group,
 * e.g. within the "Cheese" modifier group: { name: "Extra Cheese", priceDelta: 1.5 }.
 * `_id: false` because these are pure value objects with no independent identity
 * outside their parent modifier — they're never queried or referenced directly.
 */
const modifierOptionSchema = new mongoose.Schema(
  {
    name: { type: String, required: true, trim: true, maxlength: 60 },
    // Amount added to (or, if negative, subtracted from) the base item price when selected.
    priceDelta: { type: Number, required: true, default: 0 },
  },
  { _id: false }
);

/**
 * Modifier Group Sub-Schema — represents a customization category for a dish,
 * e.g. "Spice Level" (single-select, required) or "Add-ons" (multi-select, optional).
 */
const modifierGroupSchema = new mongoose.Schema(
  {
    name: { type: String, required: true, trim: true, maxlength: 60 }, // e.g. "Extra Cheese", "Spicy Options"
    // "single"  -> customer picks exactly one option (e.g. Spice Level: Mild/Medium/Hot)
    // "multiple"-> customer may pick any number of options (e.g. Add-ons: Extra Cheese, Olives)
    selectionType: {
      type: String,
      enum: {
        values: ['single', 'multiple'],
        message: '{VALUE} is not a supported modifier selection type.',
      },
      default: 'single',
    },
    isRequired: { type: Boolean, default: false },
    options: {
      type: [modifierOptionSchema],
      validate: {
        validator: (opts) => Array.isArray(opts) && opts.length > 0,
        message: 'A modifier group must contain at least one option.',
      },
    },
  },
  { _id: false }
);

/**
 * MenuItem Schema — a single dish/product belonging to exactly one tenant.
 *
 * TENANT ISOLATION: `restaurantId` is required and indexed first in every compound
 * index below. Every controller query against this collection MUST filter by
 * `restaurantId` — this schema intentionally does NOT expose any way to fetch items
 * without that scope, enforcing isolation at the data-access layer.
 */
const menuItemSchema = new mongoose.Schema(
  {
    restaurantId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'Restaurant',
      required: [true, 'Every menu item must belong to a restaurant tenant.'],
      index: true,
    },

    name: {
      type: String,
      required: [true, 'Menu item name is required.'],
      trim: true,
      maxlength: [100, 'Menu item name cannot exceed 100 characters.'],
    },

    description: {
      type: String,
      trim: true,
      maxlength: [500, 'Description cannot exceed 500 characters.'],
      default: '',
    },

    // Free-text category rather than a hard enum: restaurants define their own menu
    // sections ("Appetizers", "BBQ Specials", "Chef's Recommendations", etc.), and a
    // hard-coded enum would force a schema migration every time a tenant needs a new one.
    category: {
      type: String,
      required: [true, 'Menu item category is required.'],
      trim: true,
      maxlength: 60,
      index: true,
    },

    price: {
      type: Number,
      required: [true, 'Menu item price is required.'],
      min: [0, 'Price cannot be negative.'],
    },

    images: {
      type: [String], // Array of CDN/object-storage URLs; first entry treated as the primary image.
      default: [],
    },

    // Dietary/attribute tags for filtering — e.g. "spicy", "vegan", "gluten-free", "chef-special".
    tags: {
      type: [String],
      default: [],
    },

    modifiers: {
      type: [modifierGroupSchema],
      default: [],
    },

    // Toggled off during stock-outs without deleting the item (preserves historical Order references).
    isAvailable: {
      type: Boolean,
      default: true,
      index: true,
    },

    isFeatured: {
      type: Boolean,
      default: false,
    },

    // Simple display/sort order within a category, editable by restaurant admins.
    displayOrder: {
      type: Number,
      default: 0,
    },
  },
  {
    timestamps: true,
  }
);

// Primary tenant-scoped query pattern: "give me this restaurant's available items, grouped by category".
menuItemSchema.index({ restaurantId: 1, category: 1, displayOrder: 1 });
// Secondary pattern: "give me this restaurant's currently available items" (used by the public menu API).
menuItemSchema.index({ restaurantId: 1, isAvailable: 1 });

module.exports = mongoose.model('MenuItem', menuItemSchema);
