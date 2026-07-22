const bcrypt = require('bcryptjs');

// Higher = slower to compute (deliberately), which is exactly what makes
// brute-forcing a stolen hash impractical. 12 is a well-established, current
// industry-standard balance between security and login speed.
const SALT_ROUNDS = 12;

/**
 * Scrambles a plain-text password into a one-way hash. The original password
 * cannot be recovered from the result — this is intentional; verifying a
 * later login attempt means re-hashing THAT attempt and comparing hashes,
 * never "unscrambling" the stored one.
 */
async function hashPassword(plainTextPassword) {
  return bcrypt.hash(plainTextPassword, SALT_ROUNDS);
}

/**
 * Checks a login attempt's plain-text password against a stored hash.
 * Returns true/false — never reveals anything about the stored password.
 */
async function verifyPassword(plainTextPassword, storedHash) {
  return bcrypt.compare(plainTextPassword, storedHash);
}

module.exports = { hashPassword, verifyPassword };
