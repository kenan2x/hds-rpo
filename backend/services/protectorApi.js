const axios = require('axios');
const https = require('https');

/**
 * Hitachi Ops Center Protector / Common Services REST API Client
 *
 * IMPORTANT: Authentication goes through Ops Center Common Services,
 * which runs on port 443 by default — NOT on the Protector port (20964).
 *
 * Auth flow:
 *   POST https://{host}:443/portal/auth/v1/providers/builtin/token
 *   Header: Authorization: Basic {base64(username:password)}
 *   Response: { "access_token": "...", ... }
 *
 * After authentication, Protector API calls use the Bearer token
 * on the Protector port (default 20964).
 *
 * The bearer token expires 5 minutes after the last API access.
 */

const TOKEN_REFRESH_MS = 4 * 60 * 1000; // Refresh 4 minutes (before 5-min expiry)
const COMMON_SERVICES_PORT = 443;       // Default port for Common Services auth
const AUTH_PATH = '/portal/auth/v1/providers/builtin/token';

// In-memory token cache
let cachedToken = null;
let tokenExpiresAt = 0;

/**
 * Creates an axios client for a given host:port.
 */
function createClient(host, port, acceptSelfSigned = false) {
  const baseURL = `https://${host}:${port}`;

  return axios.create({
    baseURL,
    timeout: 30000,
    headers: {
      'Content-Type': 'application/json',
      Accept: 'application/json',
    },
    httpsAgent: new https.Agent({
      rejectUnauthorized: !acceptSelfSigned,
    }),
  });
}

/**
 * Authenticates with Ops Center Common Services to get a Bearer token.
 *
 * Common Services typically runs on port 443 (default), separate from
 * the Protector application port (20964). This function tries:
 *   1. Port 443 (Common Services default)
 *   2. The configured Protector port (as fallback, in case Common Services
 *      is reverse-proxied through the same port)
 *
 * @param {string} host
 * @param {number} protectorPort - Protector port (default 20964)
 * @param {string} username
 * @param {string} password
 * @param {boolean} [acceptSelfSigned=false]
 * @returns {Promise<string>} Bearer access token
 */
async function authenticate(host, protectorPort, username, password, acceptSelfSigned = false) {
  const basicAuth = Buffer.from(`${username}:${password}`).toString('base64');

  // Ports to try for Common Services auth
  const portsToTry = [COMMON_SERVICES_PORT];
  if (protectorPort !== COMMON_SERVICES_PORT) {
    portsToTry.push(protectorPort);
  }

  const errors = [];

  for (const port of portsToTry) {
    const client = createClient(host, port, acceptSelfSigned);

    try {
      console.log(`[protectorApi] Trying Common Services auth on ${host}:${port}${AUTH_PATH}...`);

      const response = await client.post(
        AUTH_PATH,
        {},
        { headers: { Authorization: `Basic ${basicAuth}` } }
      );

      // Extract token from response
      const token =
        response.data?.access_token ||
        response.data?.token ||
        response.data?.sessionId;

      if (token) {
        cachedToken = token;
        tokenExpiresAt = Date.now() + TOKEN_REFRESH_MS;
        console.log(`[protectorApi] Authenticated via Common Services on port ${port}.`);
        return token;
      }

      // 200 but no token — log response for debugging
      console.log(
        `[protectorApi] Port ${port}: 200 OK but no token found. ` +
        `Response keys: ${Object.keys(response.data || {}).join(', ')}`
      );
      errors.push({
        port,
        message: `200 OK ancak token bulunamadi (yanit anahtarlari: ${Object.keys(response.data || {}).join(', ')})`,
      });
    } catch (err) {
      const status = err.response?.status;
      const code = err.code;

      // SSL certificate errors — fail immediately with clear message
      const sslErrors = [
        'UNABLE_TO_VERIFY_LEAF_SIGNATURE',
        'DEPTH_ZERO_SELF_SIGNED_CERT',
        'SELF_SIGNED_CERT_IN_CHAIN',
        'CERT_HAS_EXPIRED',
        'ERR_TLS_CERT_ALTNAME_INVALID',
      ];
      if (sslErrors.includes(code)) {
        throw new Error(
          `SSL sertifika hatasi (port ${port}): ${code}. ` +
          `"Kendinden Imzali Sertifika Kabul Et" secenegini etkinlestirin.`
        );
      }

      // 401/403 = endpoint exists but credentials are wrong — stop trying
      if (status === 401 || status === 403) {
        throw new Error(
          `Kimlik dogrulama basarisiz (port ${port}). ` +
          `Kullanici adi ve sifreyi kontrol edin. (HTTP ${status})`
        );
      }

      const detail = status
        ? `HTTP ${status}`
        : code || err.message;

      console.log(`[protectorApi] Port ${port}: ${detail}`);
      errors.push({ port, message: detail });
    }
  }

  // Build a helpful error message
  const portList = errors
    .map((e) => `  - Port ${e.port}: ${e.message}`)
    .join('\n');

  throw new Error(
    `Common Services kimlik dogrulama basarisiz.\n` +
    `Auth endpoint: ${AUTH_PATH}\n` +
    `Denenen portlar:\n${portList}\n\n` +
    `Not: Common Services varsayilan portu 443'tur (Protector portu degil). ` +
    `Common Services'in bu sunucuda calistigindan emin olun.`
  );
}

/**
 * Gets a valid token, refreshing if needed.
 */
async function getToken(host, port, username, password, acceptSelfSigned) {
  if (cachedToken && Date.now() < tokenExpiresAt) {
    return cachedToken;
  }
  return authenticate(host, port, username, password, acceptSelfSigned);
}

/**
 * Makes an authenticated GET request to the Protector API.
 * Uses the Protector port (not the Common Services auth port).
 */
async function authenticatedGet(host, port, token, path, acceptSelfSigned = false) {
  const client = createClient(host, port, acceptSelfSigned);

  const response = await client.get(path, {
    headers: {
      Authorization: `Bearer ${token}`,
    },
  });

  return response.data;
}

/**
 * Discovers replication-related data from Ops Center Protector/Administrator.
 * Tries known API endpoint patterns to find replication data.
 *
 * @param {string} host
 * @param {number} port - Protector port (for API calls after auth)
 * @param {string} token - Bearer token
 * @param {boolean} [acceptSelfSigned=false]
 * @returns {Promise<Object>} Discovery results with nodes and pairs
 */
async function discoverReplication(host, port, token, acceptSelfSigned = false) {
  const results = {
    nodes: [],
    pairs: [],
    copyGroups: [],
    discoveryMethod: null,
    errors: [],
  };

  // Protector/Administrator API endpoint candidates
  const endpoints = [
    // Administrator endpoints
    { path: '/v1/objects/remote-replications', category: 'copyGroups' },
    { path: '/v1/objects/remote-storage-systems', category: 'copyGroups' },
    { path: '/v1/objects/replication-groups', category: 'copyGroups' },
    // Protector node endpoints
    { path: '/porcelain/v2/nodes', category: 'nodes' },
    { path: '/Protector/v1/objects/nodes', category: 'nodes' },
    // Pair endpoints
    { path: '/v1/objects/volume-pairs', category: 'pairs' },
    { path: '/v1/objects/remote-copy-pairs', category: 'pairs' },
    { path: '/porcelain/v2/remoteCopyPairs', category: 'pairs' },
  ];

  for (const ep of endpoints) {
    try {
      const data = await authenticatedGet(host, port, token, ep.path, acceptSelfSigned);
      const items = data?.data || data?.items || data?.nodes || data?.pairs || data || [];

      if (Array.isArray(items) && items.length > 0) {
        console.log(`[protectorApi] Found ${items.length} item(s) at ${ep.path}`);
        results[ep.category].push(...items);
        if (!results.discoveryMethod) {
          results.discoveryMethod = `${ep.category}:${ep.path}`;
        }
      }
    } catch (err) {
      const status = err.response?.status || err.code || 'error';
      results.errors.push({ endpoint: ep.path, error: `${status}` });
    }
  }

  if (!results.discoveryMethod) {
    console.warn('[protectorApi] No replication data found from any endpoint.');
  }

  return results;
}

/**
 * Tests the Protector/Common Services connection by authenticating
 * and then probing for available discovery endpoints.
 *
 * @returns {Promise<Object>} Connection test result
 */
async function testConnection(host, port, username, password, acceptSelfSigned = false) {
  try {
    const token = await authenticate(host, port, username, password, acceptSelfSigned);

    // Try to discover what endpoints are available on the Protector port
    const discovery = await discoverReplication(host, port, token, acceptSelfSigned);

    return {
      success: true,
      authenticated: true,
      discoveryMethod: discovery.discoveryMethod,
      nodesFound: discovery.nodes.length,
      pairsFound: discovery.pairs.length,
      copyGroupsFound: discovery.copyGroups.length,
      failedEndpoints: discovery.errors.map((e) => e.endpoint),
    };
  } catch (err) {
    return {
      success: false,
      authenticated: false,
      error: err.message,
      statusCode: err.response?.status,
    };
  }
}

/**
 * Clears the cached token.
 */
function clearTokenCache() {
  cachedToken = null;
  tokenExpiresAt = 0;
}

module.exports = {
  authenticate,
  getToken,
  authenticatedGet,
  discoverReplication,
  testConnection,
  clearTokenCache,
};
