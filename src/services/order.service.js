const mongoose = require('mongoose');
const Order = require('../models/Order.model');
const MenuItem = require('../models/MenuItem.model');
const ApiError = require('../utils/ApiError');
const { validateSession } = require('./tableSession.service');

const VALID_ORDER_STATUSES = ['Pending', 'Preparing', 'Ready', 'Completed', 'Cancelled'];

/**
 * Generates a short, tenant-scoped human-friendly order number, e.g. "SF-000482".
 * Uniqueness only needs to hold WITHIN a tenant (enforced by the compound index
 * on { restaurantId, orderNumber }), which keeps numbers short for kitchen staff.
 */
const generateOrderNumber = async (tenantId, tenantSlug) => {
  const prefix = tenantSlug.slice(0, 2).toUpperCase();
  const countSoFar = await Order.countDocuments({ restaurantId: tenantId });
  const sequence = String(countSoFar + 1).padStart(6, '0');
  return `${prefix}-${sequence}`;
};

/**
 * createOrderForTenant — the single implementation of "place an order", called
 * identically by the REST controller (order.controller.js) and the Socket.IO
 * 'place-order' handler (sockets/index.js).
 *
 * Centralizing this here means the pricing/validation invariants — re-pricing
 * every line from the tenant's own live MenuItem collection, never trusting a
 * client-sent price or total — only have to be gotten right in one place,
 * regardless of which transport (HTTP or WebSocket) a customer's client uses.
 *
 * @param {import('mongoose').Types.ObjectId} tenantId - DB-verified tenant id (never client input)
 * @param {string} tenantSlug - used only for the human-friendly order number prefix
 * @param {object} payload - { tableNumber, items, paymentMethod, paymentScreenshot, customerNote }
 * @returns {Promise<import('mongoose').Document>} the created Order document
 * @throws {ApiError} on any validation failure (400) or missing menu item (404)
 */
async function createOrderForTenant(tenantId, tenantSlug, payload = {}) {
  const { tableNumber, items, paymentMethod, paymentScreenshot, customerNote, sessionId } = payload;

  if (!tableNumber || typeof tableNumber !== 'string') {
    throw ApiError.badRequest('A valid table number is required.');
  }

  // The actual enforcement point for the whole "secure QR key + expiring
  // session" feature: this is what makes typing in a different table number,
  // or reusing an old screenshot of a QR code, genuinely fail — not just a
  // frontend inconvenience, but rejected here regardless of which transport
  // (REST or Socket.IO) the request came through, since both call this same
  // function. The server's own clock and its own stored session data decide
  // validity — the client's claim is never trusted on its own.
  if (!validateSession(sessionId, tenantId, tableNumber)) {
    throw ApiError.forbidden('Your table session has expired or is invalid. Please scan the QR code on your table again.');
  }

  if (!Array.isArray(items) || items.length === 0) {
    throw ApiError.badRequest('An order must include at least one item.');
  }

  if (!['Cash', 'Digital_Wallet'].includes(paymentMethod)) {
    throw ApiError.badRequest('paymentMethod must be either "Cash" or "Digital_Wallet".');
  }

  if (paymentMethod === 'Digital_Wallet' && !paymentScreenshot) {
    throw ApiError.badRequest('A payment screenshot is required when paying via Digital_Wallet.');
  }

  // Resolve and price every line item against the tenant's OWN live menu.
  const resolvedItems = [];
  let totalAmount = 0;

  for (const rawItem of items) {
    const { menuItemId, quantity, selectedModifiers = [], specialInstructions = '' } = rawItem;

    if (!mongoose.Types.ObjectId.isValid(menuItemId)) {
      throw ApiError.badRequest(`Invalid menu item id: "${menuItemId}".`);
    }
    if (!Number.isInteger(quantity) || quantity < 1) {
      throw ApiError.badRequest(`Quantity for item "${menuItemId}" must be a positive integer.`);
    }

    // Tenant isolation guard, again: this lookup can NEVER return another
    // restaurant's item, even if the client supplies a valid ObjectId for one.
    const menuItem = await MenuItem.findOne({ _id: menuItemId, restaurantId: tenantId }).lean();

    if (!menuItem) {
      throw ApiError.notFound(`Menu item "${menuItemId}" was not found for this restaurant.`);
    }
    if (!menuItem.isAvailable) {
      throw ApiError.badRequest(`"${menuItem.name}" is currently unavailable.`);
    }

    // Validate that every selected modifier actually exists on this item, and
    // compute price deltas from the SERVER'S copy, never trusting a client-sent price.
    let modifiersTotal = 0;
    const snapshottedModifiers = selectedModifiers.map(({ groupName, optionName }) => {
      const group = menuItem.modifiers.find((g) => g.name === groupName);
      if (!group) {
        throw ApiError.badRequest(`"${menuItem.name}" has no modifier group named "${groupName}".`);
      }
      const option = group.options.find((o) => o.name === optionName);
      if (!option) {
        throw ApiError.badRequest(`Modifier group "${groupName}" has no option named "${optionName}".`);
      }
      modifiersTotal += option.priceDelta;
      return { groupName, optionName, priceDelta: option.priceDelta };
    });

    const lineTotal = (menuItem.price + modifiersTotal) * quantity;
    totalAmount += lineTotal;

    resolvedItems.push({
      menuItem: menuItem._id,
      name: menuItem.name,
      unitPrice: menuItem.price,
      quantity,
      selectedModifiers: snapshottedModifiers,
      lineTotal,
      specialInstructions: specialInstructions.slice(0, 200),
    });
  }

  const orderNumber = await generateOrderNumber(tenantId, tenantSlug);

  const order = await Order.create({
    restaurantId: tenantId,
    orderNumber,
    tableNumber,
    items: resolvedItems,
    totalAmount,
    paymentMethod,
    paymentScreenshot: paymentMethod === 'Digital_Wallet' ? paymentScreenshot : null,
    customerNote: (customerNote || '').slice(0, 300),
    orderStatus: 'Pending',
  });

  return order;
}

/**
 * updateOrderStatusForTenant — shared implementation of "advance/change an
 * order's status", used by both the REST PATCH endpoint and the Socket.IO
 * 'update-order-status' handler (emitted by the admin dashboard).
 *
 * The tenant-scoped filter in `findOneAndUpdate` ensures a restaurant can only
 * ever mutate its OWN orders, even if it somehow obtains another tenant's
 * order id (e.g. two browser tabs, one per restaurant, on a shared machine).
 */
async function updateOrderStatusForTenant(tenantId, orderId, orderStatus) {
  if (!mongoose.Types.ObjectId.isValid(orderId)) {
    throw ApiError.badRequest('A valid order id must be provided.');
  }
  if (!VALID_ORDER_STATUSES.includes(orderStatus)) {
    throw ApiError.badRequest(`orderStatus must be one of: ${VALID_ORDER_STATUSES.join(', ')}.`);
  }

  const order = await Order.findOneAndUpdate(
    { _id: orderId, restaurantId: tenantId },
    { orderStatus },
    { new: true, runValidators: true }
  );

  if (!order) {
    throw ApiError.notFound('Order not found for this restaurant.');
  }

  return order;
}

module.exports = { createOrderForTenant, updateOrderStatusForTenant, VALID_ORDER_STATUSES };
