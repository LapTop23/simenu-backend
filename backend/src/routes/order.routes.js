const express = require('express');
const tenantResolver = require('../middleware/tenantResolver');
const { requireAuth, requireOwnerMatchesTenant } = require('../middleware/requireAuth');
const { createOrder, getOrdersForTenant, updateOrderStatus } = require('../controllers/order.controller');

const router = express.Router();

router.use(tenantResolver);

// POST /api/orders?res=savory-foods                 → place a new order (customer-facing, stays public)
router.post('/', createOrder);

// GET  /api/orders?res=savory-foods&status=Preparing → list ALL orders (kitchen/admin dashboard — owner only)
router.get('/', requireAuth, requireOwnerMatchesTenant, getOrdersForTenant);

// PATCH /api/orders/:orderId/status?res=savory-foods → advance an order's status (kitchen/admin — owner only)
router.patch('/:orderId/status', requireAuth, requireOwnerMatchesTenant, updateOrderStatus);

module.exports = router;
