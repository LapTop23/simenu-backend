const Order = require('../models/Order.model');
const ApiResponse = require('../utils/ApiResponse');
const ApiError = require('../utils/ApiError');
const { createOrderForTenant, updateOrderStatusForTenant, VALID_ORDER_STATUSES } = require('../services/order.service');

/**
 * POST /api/orders?res=savory-foods
 *
 * Creates a new order for the resolved tenant over plain REST. Delegates all
 * validation/pricing/persistence to order.service.createOrderForTenant, which
 * is the SAME code path used by the Socket.IO 'place-order' handler — this
 * route exists for clients that submit via HTTP rather than a live socket
 * connection (or as a fallback if a socket connection drops mid-order).
 */
const createOrder = async (req, res) => {
  try {
    const order = await createOrderForTenant(req.tenant.id, req.tenant.slug, req.body);
    return new ApiResponse(201, 'Order placed successfully.', order).send(res);
  } catch (error) {
    if (error instanceof ApiError) {
      return res.status(error.statusCode).json({ success: false, message: error.message });
    }
    console.error(`[OrderController] Failed to create order for tenant "${req.tenant?.slug}":`, error);
    return res.status(500).json({
      success: false,
      message: 'An unexpected error occurred while placing the order. Please try again.',
    });
  }
};

/**
 * GET /api/orders?res=savory-foods&status=Preparing
 *
 * Lists this tenant's orders, optionally filtered by status. Useful for an
 * admin dashboard's initial page load (the live feed then takes over via
 * Socket.IO for anything that happens afterward). Always scoped by req.tenant.id.
 */
const getOrdersForTenant = async (req, res) => {
  try {
    const { status } = req.query;
    const filter = { restaurantId: req.tenant.id };

    if (status) {
      if (!VALID_ORDER_STATUSES.includes(status)) {
        throw ApiError.badRequest(`status must be one of: ${VALID_ORDER_STATUSES.join(', ')}.`);
      }
      filter.orderStatus = status;
    }

    const orders = await Order.find(filter).sort({ createdAt: -1 }).lean();

    return new ApiResponse(200, 'Orders retrieved successfully.', orders, { count: orders.length }).send(res);
  } catch (error) {
    if (error instanceof ApiError) {
      return res.status(error.statusCode).json({ success: false, message: error.message });
    }
    console.error(`[OrderController] Failed to fetch orders for tenant "${req.tenant?.slug}":`, error);
    return res.status(500).json({
      success: false,
      message: 'An unexpected error occurred while retrieving orders.',
    });
  }
};

/**
 * PATCH /api/orders/:orderId/status?res=savory-foods
 *
 * REST fallback for updating an order's status. The admin dashboard normally
 * does this over the 'update-order-status' socket event for instant push to
 * the customer; this endpoint exists for non-realtime clients/integrations
 * and delegates to the identical service function.
 */
const updateOrderStatus = async (req, res) => {
  try {
    const { orderId } = req.params;
    const { orderStatus } = req.body;
    const order = await updateOrderStatusForTenant(req.tenant.id, orderId, orderStatus);
    return new ApiResponse(200, 'Order status updated successfully.', order).send(res);
  } catch (error) {
    if (error instanceof ApiError) {
      return res.status(error.statusCode).json({ success: false, message: error.message });
    }
    console.error(`[OrderController] Failed to update order status for tenant "${req.tenant?.slug}":`, error);
    return res.status(500).json({
      success: false,
      message: 'An unexpected error occurred while updating the order.',
    });
  }
};

module.exports = { createOrder, getOrdersForTenant, updateOrderStatus };
