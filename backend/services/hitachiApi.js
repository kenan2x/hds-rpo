const axios = require('axios');
const https = require('https');

/**
 * Hitachi Ops Center REST API Client
 *
 * Provides methods for all Hitachi Configuration Manager REST API endpoints
 * needed by the RPO Monitor. Supports SSL toggle and self-signed certificates.
 * Includes retry logic with exponential backoff for transient failures.
 */

const MAX_RETRIES = 3;
const BASE_RETRY_DELAY_MS = 1000; // 1 second, doubles each retry

/**
 * Builds the base URL for the Ops Center API.
 *
 * @param {string} host - API host or IP
 * @param {number} port - API port (default 23451)
 * @param {boolean} useSsl - Whether to use HTTPS
 * @returns {string} Base URL without trailing slash
 */
function buildBaseUrl(host, port, useSsl) {
  const protocol = useSsl ? 'https' : 'http';
  return `${protocol}://${host}:${port}/ConfigurationManager/v1`;
}

/**
 * Creates an axios instance configured for the given connection parameters.
 * When useSsl is true and acceptSelfSigned is true, the HTTPS agent will
 * skip certificate validation (rejectUnauthorized: false).
 *
 * @param {string} host
 * @param {number} port
 * @param {boolean} useSsl
 * @param {boolean} [acceptSelfSigned=false]
 * @returns {import('axios').AxiosInstance}
 */
function createClient(host, port, useSsl, acceptSelfSigned = false) {
  const baseURL = buildBaseUrl(host, port, useSsl);

  const config = {
    baseURL,
    timeout: 30000, // 30-second timeout per request
    headers: {
      'Content-Type': 'application/json',
      Accept: 'application/json',
    },
  };

  if (useSsl) {
    config.httpsAgent = new https.Agent({
      rejectUnauthorized: !acceptSelfSigned,
    });
  }

  return axios.create(config);
}

/**
 * Executes a request with retry logic. Retries up to MAX_RETRIES times
 * with exponential backoff for network errors and 5xx status codes.
 *
 * @param {Function} requestFn - Async function that performs the axios request
 * @returns {Promise<any>} Response data
 */
async function withRetry(requestFn) {
  let lastError;

  for (let attempt = 0; attempt <= MAX_RETRIES; attempt++) {
    try {
      const response = await requestFn();
      return response.data;
    } catch (error) {
      lastError = error;

      // Do not retry on client errors (4xx) except 408 (Request Timeout) and 429 (Too Many Requests)
      if (error.response) {
        const status = error.response.status;
        if (status >= 400 && status < 500 && status !== 408 && status !== 429) {
          throw error;
        }
      }

      // If we have retries left, wait with exponential backoff
      if (attempt < MAX_RETRIES) {
        const delay = BASE_RETRY_DELAY_MS * Math.pow(2, attempt);
        console.warn(
          `[hitachiApi] Request failed (attempt ${attempt + 1}/${MAX_RETRIES + 1}), ` +
          `retrying in ${delay}ms: ${error.message}`
        );
        await new Promise((resolve) => setTimeout(resolve, delay));
      }
    }
  }

  // All retries exhausted
  const message = lastError.response
    ? `HTTP ${lastError.response.status}: ${JSON.stringify(lastError.response.data)}`
    : lastError.message;
  throw new Error(`[hitachiApi] Request failed after ${MAX_RETRIES + 1} attempts: ${message}`);
}

/**
 * Lists all storage systems registered in Ops Center.
 *
 * @param {string} host - Ops Center host
 * @param {number} port - Ops Center port
 * @param {boolean} useSsl - Use HTTPS
 * @param {boolean} [acceptSelfSigned=false]
 * @returns {Promise<Object>} Storage systems list
 */
async function listStorages(host, port, useSsl, acceptSelfSigned = false) {
  const client = createClient(host, port, useSsl, acceptSelfSigned);

  return withRetry(() =>
    client.get('/objects/storages')
  );
}

/**
 * Creates a session on a specific storage system using Basic auth.
 * Returns the session token and sessionId.
 *
 * @param {string} host
 * @param {number} port
 * @param {boolean} useSsl
 * @param {string} storageDeviceId - Storage device ID (e.g., "938000412345")
 * @param {string} username
 * @param {string} password
 * @param {boolean} [acceptSelfSigned=false]
 * @param {number} [aliveTime=300] - Session alive time in seconds
 * @returns {Promise<{ token: string, sessionId: number }>}
 */
async function createSession(host, port, useSsl, storageDeviceId, username, password, acceptSelfSigned = false, aliveTime = 300) {
  const client = createClient(host, port, useSsl, acceptSelfSigned);
  const basicAuth = Buffer.from(`${username}:${password}`).toString('base64');

  return withRetry(() =>
    client.post(
      `/objects/storages/${storageDeviceId}/sessions`,
      { aliveTime },
      {
        headers: {
          Authorization: `Basic ${basicAuth}`,
        },
      }
    )
  );
}

/**
 * Deletes (closes) a session on a storage system.
 *
 * @param {string} host
 * @param {number} port
 * @param {boolean} useSsl
 * @param {string} storageDeviceId
 * @param {number} sessionId
 * @param {string} token
 * @param {boolean} [acceptSelfSigned=false]
 * @returns {Promise<void>}
 */
async function deleteSession(host, port, useSsl, storageDeviceId, sessionId, token, acceptSelfSigned = false) {
  const client = createClient(host, port, useSsl, acceptSelfSigned);

  return withRetry(() =>
    client.delete(
      `/objects/storages/${storageDeviceId}/sessions/${sessionId}`,
      {
        headers: {
          Authorization: `Session ${token}`,
        },
      }
    )
  );
}

/**
 * Refreshes the storage cache. Must be called before reading data to
 * ensure the REST API returns up-to-date information.
 *
 * @param {string} host
 * @param {number} port
 * @param {boolean} useSsl
 * @param {string} storageDeviceId
 * @param {string} token
 * @param {boolean} [acceptSelfSigned=false]
 * @returns {Promise<Object>}
 */
async function refreshCache(host, port, useSsl, storageDeviceId, token, acceptSelfSigned = false) {
  const client = createClient(host, port, useSsl, acceptSelfSigned);

  return withRetry(() =>
    client.put(
      `/objects/storages/${storageDeviceId}/views/actions/refresh/invoke`,
      {},
      {
        headers: {
          Authorization: `Session ${token}`,
        },
      }
    )
  );
}

/**
 * Retrieves journal information for a storage system.
 *
 * @param {string} host
 * @param {number} port
 * @param {boolean} useSsl
 * @param {string} storageDeviceId
 * @param {string} token
 * @param {'basic'|'detail'|'timer'} [infoType='basic'] - Level of journal detail
 * @param {boolean} [acceptSelfSigned=false]
 * @returns {Promise<Object>} Journal data
 */
async function getJournals(host, port, useSsl, storageDeviceId, token, infoType = 'basic', acceptSelfSigned = false) {
  const client = createClient(host, port, useSsl, acceptSelfSigned);

  return withRetry(() =>
    client.get(
      `/objects/storages/${storageDeviceId}/journals`,
      {
        params: { journalInfo: infoType },
        headers: {
          Authorization: `Session ${token}`,
        },
      }
    )
  );
}

/**
 * Retrieves remote mirror copy groups for a storage, including pair details.
 * Requires both a local session token and a remote session token.
 *
 * @param {string} host
 * @param {number} port
 * @param {boolean} useSsl
 * @param {string} storageDeviceId - Local storage device ID
 * @param {string} remoteStorageDeviceId - Remote storage device ID
 * @param {string} localToken - Session token for the local storage
 * @param {string} remoteToken - Session token for the remote storage
 * @param {boolean} [acceptSelfSigned=false]
 * @returns {Promise<Object>} Remote copy groups with pair details
 */
async function getRemoteCopyGroups(host, port, useSsl, storageDeviceId, remoteStorageDeviceId, localToken, remoteToken, acceptSelfSigned = false) {
  const client = createClient(host, port, useSsl, acceptSelfSigned);

  return withRetry(() =>
    client.get(
      `/objects/storages/${storageDeviceId}/remote-mirror-copygroups`,
      {
        params: {
          remoteStorageDeviceId,
          detailInfoType: 'pair',
        },
        headers: {
          Authorization: `Session ${localToken}`,
          'Remote-Authorization': `Session ${remoteToken}`,
        },
      }
    )
  );
}

/**
 * Retrieves remote copy pairs directly (without copy group context).
 * Filters for Universal Replicator (UR) pairs only.
 * Supports pagination via headLdevId and count.
 *
 * @param {string} host
 * @param {number} port
 * @param {boolean} useSsl
 * @param {string} storageDeviceId
 * @param {string} token
 * @param {number} [headLdevId=0] - Starting LDEV ID for pagination
 * @param {number} [count=500] - Max number of pairs to return (API max is 500)
 * @param {boolean} [acceptSelfSigned=false]
 * @returns {Promise<Object>} Remote copy pairs
 */
async function getRemoteCopyPairs(host, port, useSsl, storageDeviceId, token, headLdevId = 0, count = 500, acceptSelfSigned = false) {
  const client = createClient(host, port, useSsl, acceptSelfSigned);

  return withRetry(() =>
    client.get(
      `/objects/storages/${storageDeviceId}/remote-copypairs`,
      {
        params: {
          replicationType: 'UR',
          headLdevId,
          count,
        },
        headers: {
          Authorization: `Session ${token}`,
        },
      }
    )
  );
}

/**
 * Retrieves LDEV information for a specific volume.
 * Used to get numOfUsedBlock for the block delta RPO method.
 *
 * @param {string} host
 * @param {number} port
 * @param {boolean} useSsl
 * @param {string} storageDeviceId
 * @param {string} token
 * @param {number} ldevId - LDEV ID to query
 * @param {boolean} [acceptSelfSigned=false]
 * @returns {Promise<Object>} LDEV information
 */
async function getLdevInfo(host, port, useSsl, storageDeviceId, token, ldevId, acceptSelfSigned = false) {
  const client = createClient(host, port, useSsl, acceptSelfSigned);

  return withRetry(() =>
    client.get(
      `/objects/storages/${storageDeviceId}/ldevs/${ldevId}`,
      {
        headers: {
          Authorization: `Session ${token}`,
        },
      }
    )
  );
}

module.exports = {
  buildBaseUrl,
  createClient,
  listStorages,
  createSession,
  deleteSession,
  refreshCache,
  getJournals,
  getRemoteCopyGroups,
  getRemoteCopyPairs,
  getLdevInfo,
};
