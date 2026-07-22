const { Server } = require('socket.io');
const { resolveActiveTenantBySlug } = require('../services/tenant.service');
const { createOrderForTenant, updateOrderStatusForTenant } = require('../services/order.service');
const { verifyOwnerToken } = require('../utils/jwt');

/**
 * Extracts and verifies the owner's login cookie from a socket's handshake.
 * Socket.IO connections happen outside Express's normal middleware chain, so
 * `requireAuth` (used for REST routes) doesn't apply here automatically —
 * this is the socket-side equivalent. Returns the token payload
 * (`{ ownerId, restaurantId }`) if valid, or `null` otherwise. Never throws —
 * callers decide how to respond to a missing/invalid login.
 */
function getOwnerFromSocket(socket) {
  const cookieHeader = socket.handshake.headers.cookie || '';
  const match = cookieHeader.match(/(?:^|;\s*)simenu_token=([^;]+)/);
  if (!match) return null;

  try {
    return verifyOwnerToken(decodeURIComponent(match[1]));
  } catch (error) {
    return null;
  }
}

/**
 * Room-naming helpers — kept as pure functions (not string literals scattered
 * across handlers) so there is exactly one definition of "what a tenant's
 * admin room is called" and "what an individual order's room is called".
 *
 * adminRoomName is deliberately namespaced with `:admin` (rather than just the
 * tenant id) so that, if a future feature adds a customer-facing "all diners
 * at this restaurant" broadcast room, the two purposes can never collide on
 * the same room name.
 */
const adminRoomName = (tenantId) => `restaurant:${tenantId}:admin`;
const orderRoomName = (orderId) => `order:${orderId}`;
const menuRoomName = (tenantId) => `restaurant:${tenantId}:menu`;

/**
 * initializeSocket — attaches Socket.IO to the existing HTTP server and wires
 * up every real-time event SiMenu needs. Called once from server.js.
 *
 * TENANT ISOLATION STRATEGY (rooms):
 *   - An admin dashboard socket joins `restaurant:<tenantId>:admin` ONLY after
 *     `resolveActiveTenantBySlug` has independently verified the slug against
 *     the database. The tenantId used to build the room name is therefore
 *     always server-derived, never a raw value the client could forge.
 *   - A customer socket joins `order:<orderId>` only for the order IT JUST
 *     placed (the orderId comes back from `Order.create`, not from the
 *     client), so a customer can only ever receive status pushes for their
 *     own order — never another table's, even within the same restaurant.
 *   - `io.to(room).emit(...)` is therefore the only way events leave this
 *     module, and every room name passed to it was constructed from a
 *     server-verified id.
 *
 * @param {import('http').Server} httpServer
 * @param {string[]} allowedOrigins - same CORS allow-list used by Express
 * @returns {import('socket.io').Server}
 */
function initializeSocket(httpServer, allowedOrigins = []) {
  const io = new Server(httpServer, {
    cors: {
      origin: allowedOrigins.length > 0 ? allowedOrigins : '*',
      credentials: true,
    },
  });

  io.on('connection', (socket) => {
    console.log(`[Socket.IO] Connected: ${socket.id}`);

    // Lightweight, per-socket bookkeeping — useful for logging on disconnect
    // and for guarding against a socket emitting events before it has joined
    // any tenant context.
    socket.data.role = null;
    socket.data.tenantId = null;

    /**
     * 'join-admin-room' — the restaurant manager dashboard calls this once on
     * mount with its own restaurant's slug (resolved from the dashboard's own
     * URL/session, analogous to `?res=` on the customer side). On success,
     * this socket starts receiving 'new-order' and 'order-status-updated'
     * events for that tenant ONLY.
     */
    socket.on('join-admin-room', async ({ restaurantSlug } = {}, ack) => {
      try {
        const tenant = await resolveActiveTenantBySlug(restaurantSlug);

        // Owner-only gate: knowing the restaurant's slug is no longer
        // enough to see its live orders — the connecting browser must carry
        // a valid login cookie for THIS specific restaurant.
        const owner = getOwnerFromSocket(socket);
        if (!owner || String(owner.restaurantId) !== String(tenant.id)) {
          ack?.({ success: false, message: 'You must be logged in as this restaurant\'s owner to view live orders.' });
          return;
        }

        const room = adminRoomName(tenant.id);

        socket.join(room);
        socket.data.role = 'admin';
        socket.data.tenantId = tenant.id.toString();

        console.log(`[Socket.IO] ${socket.id} joined admin room "${room}" (${tenant.slug})`);
        ack?.({ success: true, restaurant: { slug: tenant.slug, name: tenant.name, currency: tenant.currency } });
      } catch (error) {
        console.warn(`[Socket.IO] join-admin-room rejected for ${socket.id}: ${error.message}`);
        ack?.({ success: false, message: error.message || 'Unable to join the admin room.' });
      }
    });

    /**
     * 'place-order' — the customer-facing equivalent of POST /api/orders,
     * delivered over the socket so the admin dashboard learns about it
     * instantly instead of via polling. Uses the exact same
     * `createOrderForTenant` service the REST controller uses, so pricing and
     * validation rules can never drift between the two transports.
     */
    socket.on('place-order', async ({ restaurantSlug, order } = {}, ack) => {
      try {
        const tenant = await resolveActiveTenantBySlug(restaurantSlug);
        const createdOrder = await createOrderForTenant(tenant.id, tenant.slug, order);

        // This customer's socket now "owns" this order's room — status pushes
        // for this specific order will only ever be sent here.
        const room = orderRoomName(createdOrder._id);
        socket.join(room);
        socket.data.role = 'customer';
        socket.data.tenantId = tenant.id.toString();

        // Broadcast to the tenant's admin dashboard(s) ONLY — the room name is
        // built from `tenant.id`, which came from the DB lookup above, not
        // from anything the client sent directly.
        io.to(adminRoomName(tenant.id)).emit('new-order', createdOrder);

        console.log(`[Socket.IO] New order ${createdOrder.orderNumber} placed for tenant "${tenant.slug}"`);
        ack?.({ success: true, order: createdOrder });
      } catch (error) {
        console.warn(`[Socket.IO] place-order failed for ${socket.id}: ${error.message}`);
        ack?.({ success: false, message: error.message || 'Unable to place order.' });
      }
    });

    /**
     * 'update-order-status' — emitted by the admin dashboard when staff move
     * an order through Pending → Preparing → Ready → Completed (or Cancel).
     * Pushes the update to exactly two audiences:
     *   1. The customer who placed that specific order (`order:<id>` room).
     *   2. Every other admin device watching this tenant's dashboard, so two
     *      staff members looking at the same dashboard never see stale state.
     */
    socket.on('update-order-status', async ({ restaurantSlug, orderId, orderStatus } = {}, ack) => {
      try {
        const tenant = await resolveActiveTenantBySlug(restaurantSlug);

        const owner = getOwnerFromSocket(socket);
        if (!owner || String(owner.restaurantId) !== String(tenant.id)) {
          ack?.({ success: false, message: 'You must be logged in as this restaurant\'s owner to update an order.' });
          return;
        }

        const updatedOrder = await updateOrderStatusForTenant(tenant.id, orderId, orderStatus);

        const statusPayload = {
          orderId: updatedOrder._id,
          orderNumber: updatedOrder.orderNumber,
          orderStatus: updatedOrder.orderStatus,
        };

        io.to(orderRoomName(updatedOrder._id)).emit('order-status-updated', statusPayload);
        io.to(adminRoomName(tenant.id)).emit('order-status-updated', statusPayload);

        console.log(`[Socket.IO] Order ${updatedOrder.orderNumber} → ${updatedOrder.orderStatus}`);
        ack?.({ success: true, order: updatedOrder });
      } catch (error) {
        console.warn(`[Socket.IO] update-order-status failed for ${socket.id}: ${error.message}`);
        ack?.({ success: false, message: error.message || 'Unable to update order status.' });
      }
    });

    /**
     * 'join-menu-room' — every customer browsing the digital menu joins this
     * on page load (see hooks/useTenantMenu.js). It's what makes menu CRUD
     * done from the admin dashboard (create/update/delete/availability
     * toggle) reach an already-open customer tab instantly — no polling, no
     * page refresh. Read-only from the customer's side: nothing customers do
     * ever writes to this room, they only receive 'menu-item-created',
     * 'menu-item-updated', and 'menu-item-deleted' broadcasts here.
     */
    socket.on('join-menu-room', async ({ restaurantSlug } = {}, ack) => {
      try {
        const tenant = await resolveActiveTenantBySlug(restaurantSlug);
        socket.join(menuRoomName(tenant.id));
        ack?.({ success: true });
      } catch (error) {
        ack?.({ success: false, message: error.message || 'Unable to subscribe to live menu updates.' });
      }
    });

    socket.on('disconnect', (reason) => {
      console.log(`[Socket.IO] Disconnected: ${socket.id} (role: ${socket.data.role || 'unknown'}, reason: ${reason})`);
    });
  });

  return io;
}

module.exports = { initializeSocket, adminRoomName, orderRoomName, menuRoomName };
