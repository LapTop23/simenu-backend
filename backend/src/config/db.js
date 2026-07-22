const mongoose = require('mongoose');

/**
 * Establishes the single, pooled Mongoose connection used by every tenant.
 *
 * Architectural note: because SI-Menu uses a "shared database / shared collection"
 * multi-tenancy model (see ARCHITECTURE.md), there is exactly ONE connection pool for
 * the entire platform. Tenant isolation is enforced at the query level (via
 * `restaurantId` filters), not at the connection level. This keeps connection counts
 * flat regardless of how many restaurants onboard, which is essential for horizontal
 * scalability.
 */
const connectDB = async () => {
  try {
    const mongoUri = process.env.MONGO_URI;

    if (!mongoUri) {
      throw new Error('MONGO_URI is not defined in the environment configuration.');
    }

    mongoose.set('strictQuery', true); // Reject queries on undefined schema fields — fails loudly instead of silently ignoring typos.

    const conn = await mongoose.connect(mongoUri, {
      maxPoolSize: 50, // Sized for a multi-tenant workload with many short-lived queries.
      serverSelectionTimeoutMS: 10000,
    });

    console.log(`[MongoDB] Connected → host: ${conn.connection.host}, db: ${conn.connection.name}`);

    mongoose.connection.on('error', (err) => {
      console.error('[MongoDB] Connection error after initial connect:', err.message);
    });

    mongoose.connection.on('disconnected', () => {
      console.warn('[MongoDB] Connection lost. Mongoose will attempt to reconnect automatically.');
    });
  } catch (error) {
    console.error(`[MongoDB] Initial connection failed: ${error.message}`);
    // A failed DB connection means the API cannot safely serve any tenant — fail fast.
    process.exit(1);
  }
};

module.exports = connectDB;
