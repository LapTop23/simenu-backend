const mongoose = require('mongoose');
const asyncHandler = require('../utils/asyncHandler');
const { resolveActiveTenantBySlug } = require('../services/tenant.service');

/**
 * tenantResolver — THE single choke point for multi-tenant security over REST.
 *
 * Every tenant-scoped route (menu, orders, restaurant profile) runs this middleware
 * BEFORE its controller. It delegates the actual lookup/verification to
 * `tenant.service.resolveActiveTenantBySlug`, which is shared with the Socket.IO
 * layer (see src/sockets/index.js) — so a REST request and a socket event apply
 * IDENTICAL tenant-isolation rules, rather than two hand-maintained copies that
 * could quietly drift apart.
 *
 * CRITICAL RULE ENFORCED DOWNSTREAM: every controller must scope its database
 * queries using `req.tenant.id` — and ONLY `req.tenant.id` — never a restaurantId
 * pulled from `req.body`, `req.query`, or `req.params`.
 */
const tenantResolver = asyncHandler(async (req, res, next) => {
  // Accept the identifier from the query string per the task's specified contract
  // (`/api/menu?res=savory-foods`). Also fall back to a `x-restaurant-slug` header so
  // the same middleware can serve non-GET requests (order creation, etc.) without
  // forcing the slug into every request body.
  const rawSlug = req.query.res || req.headers['x-restaurant-slug'];

  // Trusted, minimal tenant context — this is the ONLY object downstream code should
  // read tenant identity from.
  req.tenant = await resolveActiveTenantBySlug(rawSlug);

  next();
});

/**
 * Small helper other modules can use to assert a value is a valid Mongo ObjectId
 * before using it in a query — used, for example, when a route also accepts a
 * :menuItemId or :orderId path param that must be validated before querying.
 */
tenantResolver.isValidObjectId = (value) => mongoose.Types.ObjectId.isValid(value);

module.exports = tenantResolver;
