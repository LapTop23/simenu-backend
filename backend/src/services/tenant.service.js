const Restaurant = require('../models/Restaurant.model');
const ApiError = require('../utils/ApiError');

const SLUG_PATTERN = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;

/**
 * resolveActiveTenantBySlug — the ONE function that translates a client-supplied
 * restaurant slug into a trusted, DB-verified tenant context.
 *
 * Extracted out of the HTTP-only `tenantResolver` middleware so that Socket.IO
 * event handlers (which have no `req`/`res`) can perform the exact same
 * verification before joining a socket to any tenant-scoped room. This is what
 * keeps real-time tenant isolation as airtight as the REST layer: a socket can
 * only ever join `restaurant:<id>:admin` for an `id` that this function itself
 * looked up — never an id supplied directly by the client.
 *
 * @param {string} rawSlug
 * @returns {Promise<{id, slug, name, branding, currency, taxPercentage}>}
 * @throws {ApiError} 400 for malformed input, 404 for unknown/inactive tenants
 */
async function resolveActiveTenantBySlug(rawSlug) {
  if (!rawSlug || typeof rawSlug !== 'string' || !rawSlug.trim()) {
    throw ApiError.badRequest(
      'A restaurant identifier is required. Provide it via the "res" query parameter (e.g. ?res=savory-foods).'
    );
  }

  const slug = rawSlug.trim().toLowerCase();

  if (!SLUG_PATTERN.test(slug)) {
    throw ApiError.badRequest('The provided restaurant identifier is not in a valid format.');
  }

  const restaurant = await Restaurant.findOne({ slug, 'config.isActive': true })
    .select('_id slug name branding config.currency config.taxPercentage')
    .lean();

  if (!restaurant) {
    // Deliberately generic — never reveals whether the slug never existed or was deactivated.
    throw ApiError.notFound(`No active restaurant was found for identifier "${slug}".`);
  }

  return {
    id: restaurant._id,
    slug: restaurant.slug,
    name: restaurant.name,
    branding: restaurant.branding,
    currency: restaurant.config?.currency ?? 'PKR',
    taxPercentage: restaurant.config?.taxPercentage ?? 0,
  };
}

module.exports = { resolveActiveTenantBySlug };
