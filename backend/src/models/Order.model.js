const mongoose = require('mongoose');

/**
 * Selected Modifier Sub-Schema — records exactly which modifier option a customer
 * picked at order time, and the price delta that applied. Stored as a snapshot
 * (not a live reference) so historical orders remain accurate even if the
 * restaurant later edits or removes that modifier from the live menu.
 */
const selectedModifierSchema = new mongoose.Schema(
  {
    groupName: { type: String, required: true, trim: true }, // e.g. "Spice Level"
    optionName: { type: String, required: true, trim: true }, // e.g. "Extra Hot"
    priceDelta: { type: Number, required: true, default: 0 },
  },
  { _id: false }
);

/**
 * Order Line Item Sub-Schema — one dish within an order.
 *
 * `menuItem` is kept as a reference for traceability/analytics, but `name` and
 * `unitPrice` are SNAPSHOTTED at order time. This is a deliberate denormalization:
 * menu prices change over time, and an order's historical total must never shift
 * just because the restaurant later updates its live menu pricing.
 */
const orderItemSchema = new mongoose.Schema(
  {
    menuItem: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'MenuItem',
      required: true,
    },
    name: { type: String, required: true, trim: true }, // snapshot of MenuItem.name at order time
    unitPrice: { type: Number, required: true, min: 0 }, // snapshot of MenuItem.price at order time
    quantity: { type: Number, required: true, min: [1, 'Quantity must be at least 1.'] },
    selectedModifiers: { type: [selectedModifierSchema], default: [] },
    // Line subtotal = (unitPrice + sum of selectedModifiers.priceDelta) * quantity.
    // Persisted (not computed on read) so historical receipts remain stable and queryable.
    lineTotal: { type: Number, required: true, min: 0 },
    specialInstructions: { type: String, trim: true, maxlength: 200, default: '' },
  },
  { _id: false }
);

/**
 * Order Schema — a single customer order, always scoped to exactly one tenant.
 *
 * TENANT ISOLATION: identical pattern to MenuItem — `restaurantId` is required,
 * indexed, and must be the leading field of every compound index so that the
 * kitchen-display / order-status queries (which run continuously, per-tenant,
 * in real time) always hit an index rather than scanning the whole collection.
 */
const orderSchema = new mongoose.Schema(
  {
    restaurantId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'Restaurant',
      required: [true, 'Every order must belong to a restaurant tenant.'],
      index: true,
    },

    // Human-friendly, tenant-scoped sequential-looking reference shown to staff/customers
    // (e.g. "SF-000482"). Generated in the controller at creation time; not globally unique
    // across tenants by design, only unique per restaurant, which keeps numbers short and
    // reduces the temptation to treat it as a security token (restaurantId still gates access).
    orderNumber: {
      type: String,
      required: true,
      trim: true,
    },

    tableNumber: {
      type: String, // String (not Number) to support tables labeled "T-12", "Patio-3", etc.
      required: [true, 'Table number is required.'],
      trim: true,
      maxlength: 20,
    },

    items: {
      type: [orderItemSchema],
      validate: {
        validator: (items) => Array.isArray(items) && items.length > 0,
        message: 'An order must contain at least one item.',
      },
    },

    totalAmount: {
      type: Number,
      required: true,
      min: [0, 'Total amount cannot be negative.'],
    },

    orderStatus: {
      type: String,
      enum: {
        values: ['Pending', 'Preparing', 'Ready', 'Completed', 'Cancelled'],
        message: '{VALUE} is not a valid order status.',
      },
      default: 'Pending',
      index: true,
    },

    paymentMethod: {
      type: String,
      enum: {
        values: ['Cash', 'Digital_Wallet'],
        message: '{VALUE} is not a supported payment method.',
      },
      required: [true, 'Payment method is required.'],
    },

    // Only populated when paymentMethod === 'Digital_Wallet' — a URL to the customer-uploaded
    // proof-of-payment image (e.g. bank transfer / mobile wallet screenshot), stored in object
    // storage (S3/Cloudinary) with only the URL persisted here.
    paymentScreenshot: {
      type: String,
      trim: true,
      default: null,
    },

    customerNote: {
      type: String,
      trim: true,
      maxlength: 300,
      default: '',
    },
  },
  {
    timestamps: true,
  }
);

// Primary real-time query pattern: "show this restaurant's active orders, newest first"
// (powers the kitchen display / order dashboard, polled or subscribed to continuously).
orderSchema.index({ restaurantId: 1, orderStatus: 1, createdAt: -1 });
// Supports "look up this restaurant's order by its human-friendly number" (receipts, support).
orderSchema.index({ restaurantId: 1, orderNumber: 1 });

/**
 * Schema-level guard: a Digital_Wallet payment should carry proof of payment.
 * Enforced here (not just in the controller) so the invariant holds regardless of
 * which code path creates an Order in the future (API, admin tool, migration script).
 */
orderSchema.pre('validate', function enforceDigitalWalletProof(next) {
  if (this.paymentMethod === 'Digital_Wallet' && !this.paymentScreenshot) {
    return next(new Error('A payment screenshot is required for Digital_Wallet payments.'));
  }
  next();
});

module.exports = mongoose.model('Order', orderSchema);
