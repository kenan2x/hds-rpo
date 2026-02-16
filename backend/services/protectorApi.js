const axios = require('axios');
const https = require('https');

/**
 * Hitachi Ops Center Protector REST API Client
 *
 * Based on: Ops Center Protector REST API User Guide (7.10.x)
 * https://docs.hitachivantara.com/r/en-us/ops-center-protector/7.10.x/mk-99prt005
 *
 * Auth flow:
 *   POST /API/<version>/master/UIController/services/Users/actions/login/invoke
 *   Body (form-urlencoded): username=<user>&password=<pass>&space=master
 *   Response: Set-Cookie header with session cookie
 *
 * All subsequent requests include the session cookie.
 * Session is valid for 2 hours of inactivity.
 *
 * Base URL: https://<host>:<port>/API/<version>/
 * Default port: 443 (can be changed during installation, e.g. 20964)
 */

const SESSION_TIMEOUT_MS = 110 * 60 * 1000; // Refresh before 2-hour expiry
const API_VERSIONS = ['7.10', '7.1'];       // Try these API version prefixes

// In-memory session cache
let cachedCookie = null;
let sessionExpiresAt = 0;
let resolvedApiVersion = null;

/**
 * Creates an axios client for the Protector API.
 */
function createClient(host, port, acceptSelfSigned = false) {
  const baseURL = `https://${host}:${port}`;

  return axios.create({
    baseURL,
    timeout: 30000,
    httpsAgent: new https.Agent({
      rejectUnauthorized: !acceptSelfSigned,
    }),
    // Do not follow redirects automatically for cookie handling
    maxRedirects: 5,
  });
}

/**
 * Detects the correct API version by calling the ProductInformation endpoint
 * (which does not require authentication).
 */
async function detectApiVersion(host, port, acceptSelfSigned = false) {
  if (resolvedApiVersion) return resolvedApiVersion;

  const client = createClient(host, port, acceptSelfSigned);

  for (const version of API_VERSIONS) {
    try {
      const url = `/API/${version}/master/NodeManager/objects/ProductInformation/`;
      console.log(`[protectorApi] Trying API version ${version}...`);
      const response = await client.get(url);

      if (response.data?.masterVersion || response.data?.id) {
        resolvedApiVersion = version;
        console.log(
          `[protectorApi] Detected API version: ${version} ` +
          `(master: ${response.data.masterVersion || 'unknown'})`
        );
        return version;
      }
    } catch (err) {
      // Try next version
    }
  }

  // Default to first version if detection fails
  console.warn('[protectorApi] Could not detect API version, defaulting to 7.1');
  resolvedApiVersion = '7.1';
  return resolvedApiVersion;
}

/**
 * Authenticates with Ops Center Protector to create a session.
 *
 * Login endpoint:
 *   POST /API/<version>/master/UIController/services/Users/actions/login/invoke
 *   Body: username=<user>&password=<pass>&space=master
 *   Response: Set-Cookie header
 *
 * @param {string} host
 * @param {number} port - Protector port (default 443 or custom e.g. 20964)
 * @param {string} username
 * @param {string} password
 * @param {boolean} [acceptSelfSigned=false]
 * @returns {Promise<string>} Session cookie string
 */
async function authenticate(host, port, username, password, acceptSelfSigned = false) {
  const apiVersion = await detectApiVersion(host, port, acceptSelfSigned);
  const client = createClient(host, port, acceptSelfSigned);

  const loginUrl = `/API/${apiVersion}/master/UIController/services/Users/actions/login/invoke`;

  console.log(`[protectorApi] Logging in to ${host}:${port}${loginUrl}...`);

  try {
    const response = await client.post(
      loginUrl,
      `username=${encodeURIComponent(username)}&password=${encodeURIComponent(password)}&space=master`,
      {
        headers: {
          'Content-Type': 'application/x-www-form-urlencoded',
        },
      }
    );

    // Extract session cookie from Set-Cookie header
    const setCookies = response.headers['set-cookie'];
    if (!setCookies || setCookies.length === 0) {
      throw new Error('Login basarili ancak session cookie donmedi.');
    }

    // Combine all cookies into a single cookie string
    const cookieString = setCookies
      .map((c) => c.split(';')[0])
      .join('; ');

    cachedCookie = cookieString;
    sessionExpiresAt = Date.now() + SESSION_TIMEOUT_MS;

    console.log(`[protectorApi] Login basarili (${host}:${port}).`);
    return cookieString;
  } catch (err) {
    // SSL certificate errors
    const sslErrors = [
      'UNABLE_TO_VERIFY_LEAF_SIGNATURE',
      'DEPTH_ZERO_SELF_SIGNED_CERT',
      'SELF_SIGNED_CERT_IN_CHAIN',
    ];
    if (sslErrors.includes(err.code)) {
      throw new Error(
        `SSL sertifika hatasi: ${err.code}. ` +
        `"Kendinden Imzali Sertifika Kabul Et" secenegini etkinlestirin.`
      );
    }

    if (err.response?.status === 401 || err.response?.status === 403) {
      throw new Error(
        `Kimlik dogrulama basarisiz. Kullanici adi ve sifreyi kontrol edin. (HTTP ${err.response.status})`
      );
    }

    if (err.response?.status === 404) {
      throw new Error(
        `Login endpoint bulunamadi (404). Protector API versiyonu kontrol edin. ` +
        `Denenen: ${loginUrl}`
      );
    }

    const detail = err.response?.status
      ? `HTTP ${err.response.status}`
      : err.code || err.message;

    throw new Error(`Protector login basarisiz: ${detail}`);
  }
}

/**
 * Gets a valid session cookie, re-authenticating if needed.
 */
async function getSession(host, port, username, password, acceptSelfSigned) {
  if (cachedCookie && Date.now() < sessionExpiresAt) {
    return cachedCookie;
  }
  return authenticate(host, port, username, password, acceptSelfSigned);
}

/**
 * Makes an authenticated GET request to the Protector API.
 * Uses session cookie (not Bearer token).
 */
async function authenticatedGet(host, port, cookie, path, acceptSelfSigned = false) {
  const client = createClient(host, port, acceptSelfSigned);

  const response = await client.get(path, {
    headers: {
      Cookie: cookie,
    },
  });

  return response.data;
}

/**
 * Discovers replication-related data from Ops Center Protector.
 *
 * Key endpoints:
 *   - Nodes: /API/<v>/master/NodeManager/objects/Nodes
 *   - DataFlows: /API/<v>/master/DataFlowHandler/objects/DataFlows
 *   - RPO Report: /API/<v>/master/ReportHandler/objects/RPOS/Current/collections/entries
 *
 * @param {string} host
 * @param {number} port
 * @param {string} cookie - Session cookie
 * @param {boolean} [acceptSelfSigned=false]
 * @returns {Promise<Object>} Discovery results
 */
async function discoverReplication(host, port, cookie, acceptSelfSigned = false) {
  const apiVersion = resolvedApiVersion || '7.1';

  const results = {
    nodes: [],
    dataFlows: [],
    rpoReport: [],
    discoveryMethod: null,
    errors: [],
  };

  // 1. Get Nodes
  try {
    const nodesUrl = `/API/${apiVersion}/master/NodeManager/objects/Nodes`;
    const data = await authenticatedGet(host, port, cookie, nodesUrl, acceptSelfSigned);
    const nodes = data?.node || data?.nodes || [];
    if (Array.isArray(nodes) && nodes.length > 0) {
      results.nodes = nodes;
      results.discoveryMethod = 'protector:nodes';
      console.log(`[protectorApi] Found ${nodes.length} node(s).`);
    }
  } catch (err) {
    results.errors.push({ endpoint: 'Nodes', error: err.message });
  }

  // 2. Get DataFlows
  try {
    const dfUrl = `/API/${apiVersion}/master/DataFlowHandler/objects/DataFlows`;
    const data = await authenticatedGet(host, port, cookie, dfUrl, acceptSelfSigned);
    const flows = data?.dataFlow || data?.dataFlows || [];
    if (Array.isArray(flows) && flows.length > 0) {
      results.dataFlows = flows;
      if (!results.discoveryMethod) results.discoveryMethod = 'protector:dataflows';
      console.log(`[protectorApi] Found ${flows.length} data flow(s).`);
    }
  } catch (err) {
    results.errors.push({ endpoint: 'DataFlows', error: err.message });
  }

  // 3. Get RPO Report
  try {
    const rpoUrl = `/API/${apiVersion}/master/ReportHandler/objects/RPOS/Current/collections/entries`;
    const data = await authenticatedGet(host, port, cookie, rpoUrl, acceptSelfSigned);
    const entries = data?.rPOReportEntry || data?.entries || [];
    if (Array.isArray(entries) && entries.length > 0) {
      results.rpoReport = entries;
      if (!results.discoveryMethod) results.discoveryMethod = 'protector:rpo';
      console.log(`[protectorApi] Found ${entries.length} RPO report entry(ies).`);
    }
  } catch (err) {
    results.errors.push({ endpoint: 'RPO Report', error: err.message });
  }

  if (!results.discoveryMethod) {
    console.warn('[protectorApi] No data found from Protector API endpoints.');
  }

  return results;
}

/**
 * Tests the Protector connection by logging in and querying endpoints.
 *
 * @returns {Promise<Object>} Connection test result
 */
async function testConnection(host, port, username, password, acceptSelfSigned = false) {
  try {
    const cookie = await authenticate(host, port, username, password, acceptSelfSigned);

    // Try to discover what data is available
    const discovery = await discoverReplication(host, port, cookie, acceptSelfSigned);

    return {
      success: true,
      authenticated: true,
      apiVersion: resolvedApiVersion,
      discoveryMethod: discovery.discoveryMethod,
      nodesFound: discovery.nodes.length,
      dataFlowsFound: discovery.dataFlows.length,
      rpoEntriesFound: discovery.rpoReport.length,
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
 * Logs out and clears the session.
 */
async function logout(host, port, acceptSelfSigned = false) {
  if (!cachedCookie || !resolvedApiVersion) return;

  try {
    const client = createClient(host, port, acceptSelfSigned);
    await client.post(
      `/API/${resolvedApiVersion}/master/UIController/services/Users/actions/logout/invoke`,
      {},
      { headers: { Cookie: cachedCookie } }
    );
  } catch {
    // Ignore logout errors
  }

  cachedCookie = null;
  sessionExpiresAt = 0;
}

/**
 * Clears the cached session without logout.
 */
function clearSessionCache() {
  cachedCookie = null;
  sessionExpiresAt = 0;
  resolvedApiVersion = null;
}

module.exports = {
  authenticate,
  getSession,
  authenticatedGet,
  detectApiVersion,
  discoverReplication,
  testConnection,
  logout,
  clearSessionCache,
};
