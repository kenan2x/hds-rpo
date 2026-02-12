const axios = require('axios');
const https = require('https');

/**
 * Hitachi Ops Center Protector / Common Services REST API Client
 *
 * Handles authentication via Ops Center Common Services (Bearer token)
 * and discovery of replication pairs through the Ops Center Administrator
 * or Protector REST API endpoints.
 *
 * Auth flow:
 *   POST /portal/auth/v1/providers/builtin/token  (Basic auth → Bearer token)
 *
 * The bearer token expires 5 minutes after the last API access.
 */

const TOKEN_REFRESH_MS = 4 * 60 * 1000; // Refresh 4 minutes (before 5-min expiry)

// In-memory token cache
let cachedToken = null;
let tokenExpiresAt = 0;

/**
 * Creates an axios client for the Protector/Common Services API.
 */
function createClient(host, port, acceptSelfSigned = false) {
  const baseURL = `https://${host}:${port}`;

  const config = {
    baseURL,
    timeout: 30000,
    headers: {
      'Content-Type': 'application/json',
      Accept: 'application/json',
    },
    httpsAgent: new https.Agent({
      rejectUnauthorized: !acceptSelfSigned,
    }),
  };

  return axios.create(config);
}

/**
 * Authenticates with Ops Center Common Services to get a Bearer token.
 *
 * @param {string} host
 * @param {number} port - Protector port (default 20964)
 * @param {string} username
 * @param {string} password
 * @param {boolean} [acceptSelfSigned=false]
 * @returns {Promise<string>} Bearer access token
 */
async function authenticate(host, port, username, password, acceptSelfSigned = false) {
  const client = createClient(host, port, acceptSelfSigned);
  const basicAuth = Buffer.from(`${username}:${password}`).toString('base64');

  // Try the standard Common Services auth endpoint
  const response = await client.post(
    '/portal/auth/v1/providers/builtin/token',
    {},
    {
      headers: {
        Authorization: `Basic ${basicAuth}`,
      },
    }
  );

  // The response may contain the token in different formats depending on version
  const token =
    response.data?.access_token ||
    response.data?.token ||
    response.headers?.['x-auth-token'];

  if (!token) {
    throw new Error(
      'Authentication succeeded but no token found in response. ' +
      `Response keys: ${Object.keys(response.data || {}).join(', ')}`
    );
  }

  // Cache the token
  cachedToken = token;
  tokenExpiresAt = Date.now() + TOKEN_REFRESH_MS;

  console.log('[protectorApi] Successfully authenticated with Ops Center Common Services.');
  return token;
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
 * Makes an authenticated GET request to the Ops Center API.
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
 * Tries multiple API endpoint patterns to find replication pairs.
 *
 * @param {string} host
 * @param {number} port
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

  // Strategy 1: Try Ops Center Administrator API endpoints
  const adminEndpoints = [
    '/v1/objects/remote-replications',
    '/v1/objects/remote-storage-systems',
    '/v1/objects/replication-groups',
  ];

  for (const endpoint of adminEndpoints) {
    try {
      const data = await authenticatedGet(host, port, token, endpoint, acceptSelfSigned);
      const items = data?.data || data?.items || data || [];
      if (Array.isArray(items) && items.length > 0) {
        console.log(`[protectorApi] Found data at ${endpoint}: ${items.length} item(s)`);
        results.copyGroups.push(...items);
        results.discoveryMethod = `administrator:${endpoint}`;
      }
    } catch (err) {
      const status = err.response?.status || 'network error';
      results.errors.push({ endpoint, error: `${status}: ${err.message}` });
    }
  }

  // Strategy 2: Try Protector-specific API endpoints
  const protectorEndpoints = [
    '/Protector/v1/objects/nodes',
    '/porcelain/v2/nodes',
    '/API/v1/master/NodeManager/Node',
    '/API/v1/master/DataFlowManager/DataFlow',
  ];

  for (const endpoint of protectorEndpoints) {
    try {
      const data = await authenticatedGet(host, port, token, endpoint, acceptSelfSigned);
      const items = data?.data || data?.nodes || data?.items || data || [];
      if (Array.isArray(items) && items.length > 0) {
        console.log(`[protectorApi] Found nodes at ${endpoint}: ${items.length} item(s)`);
        results.nodes.push(...items);
        if (!results.discoveryMethod) {
          results.discoveryMethod = `protector:${endpoint}`;
        }
      }
    } catch (err) {
      const status = err.response?.status || 'network error';
      results.errors.push({ endpoint, error: `${status}: ${err.message}` });
    }
  }

  // Strategy 3: Try listing volume pairs directly
  const pairEndpoints = [
    '/v1/objects/volume-pairs',
    '/v1/objects/remote-copy-pairs',
    '/porcelain/v2/remoteCopyPairs',
    '/porcelain/v2/volume-pairs',
  ];

  for (const endpoint of pairEndpoints) {
    try {
      const data = await authenticatedGet(host, port, token, endpoint, acceptSelfSigned);
      const items = data?.data || data?.pairs || data?.items || data || [];
      if (Array.isArray(items) && items.length > 0) {
        console.log(`[protectorApi] Found pairs at ${endpoint}: ${items.length} item(s)`);
        results.pairs.push(...items);
        if (!results.discoveryMethod) {
          results.discoveryMethod = `pairs:${endpoint}`;
        }
      }
    } catch (err) {
      const status = err.response?.status || 'network error';
      results.errors.push({ endpoint, error: `${status}: ${err.message}` });
    }
  }

  if (!results.discoveryMethod) {
    console.warn(
      '[protectorApi] Could not discover replication data from any endpoint. ' +
      'Tried:', [...adminEndpoints, ...protectorEndpoints, ...pairEndpoints].join(', ')
    );
  }

  return results;
}

/**
 * Tests the Protector/Common Services connection by authenticating.
 *
 * @returns {Promise<Object>} Connection test result
 */
async function testConnection(host, port, username, password, acceptSelfSigned = false) {
  try {
    const token = await authenticate(host, port, username, password, acceptSelfSigned);

    // Try to discover what endpoints are available
    const discovery = await discoverReplication(host, port, token, acceptSelfSigned);

    // Determine which endpoints responded
    const workingEndpoints = [];
    const failedEndpoints = [];

    for (const err of discovery.errors) {
      if (err.error.startsWith('404') || err.error.startsWith('401') || err.error.startsWith('403')) {
        failedEndpoints.push(err.endpoint);
      } else {
        failedEndpoints.push(`${err.endpoint} (${err.error})`);
      }
    }

    return {
      success: true,
      authenticated: true,
      discoveryMethod: discovery.discoveryMethod,
      nodesFound: discovery.nodes.length,
      pairsFound: discovery.pairs.length,
      copyGroupsFound: discovery.copyGroups.length,
      workingEndpoints,
      failedEndpoints: discovery.errors.map((e) => e.endpoint),
    };
  } catch (err) {
    return {
      success: false,
      authenticated: false,
      error: err.response?.data?.message || err.message,
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
