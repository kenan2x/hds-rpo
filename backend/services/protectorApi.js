const axios = require('axios');
const https = require('https');

/**
 * Hitachi Ops Center Protector REST API Client
 *
 * Mimari:
 *   Protector  → Depolama sistemleri ve replikasyon topolojisi kesfeder
 *   Config Mgr → Volume detaylari (journal, LDEV) icin kullanilir
 *
 * Auth:
 *   POST /API/<version>/master/UIController/services/Users/actions/login/invoke
 *   Body (form-urlencoded): username=<user>&password=<pass>&space=master
 *   Response: Set-Cookie header → sonraki isteklerde Cookie header olarak gonderilir
 *   Oturum suresi: 2 saat (inaktivite)
 *
 * Base URL: https://<host>:<port>/API/<version>/
 *
 * Kaynak: Ops Center Protector REST API User Guide (7.10.x)
 */

const SESSION_TIMEOUT_MS = 110 * 60 * 1000; // 2 saatten once yenile
const API_VERSIONS = ['7.10', '7.1'];

// Oturum cache
let cachedCookie = null;
let sessionExpiresAt = 0;
let resolvedApiVersion = null;

/**
 * Protector API icin axios client olusturur.
 */
function createClient(host, port, acceptSelfSigned = false) {
  return axios.create({
    baseURL: `https://${host}:${port}`,
    timeout: 30000,
    httpsAgent: new https.Agent({
      rejectUnauthorized: !acceptSelfSigned,
    }),
    maxRedirects: 5,
  });
}

/**
 * API versiyonunu tespit eder (auth gerektirmez).
 * ProductInformation endpoint'ini kullanir.
 */
async function detectApiVersion(host, port, acceptSelfSigned = false) {
  if (resolvedApiVersion) return resolvedApiVersion;

  const client = createClient(host, port, acceptSelfSigned);

  for (const version of API_VERSIONS) {
    try {
      const url = `/API/${version}/master/NodeManager/objects/ProductInformation/`;
      console.log(`[protector] API versiyon deneniyor: ${version}`);
      const response = await client.get(url);

      if (response.data?.masterVersion || response.data?.id) {
        resolvedApiVersion = version;
        console.log(`[protector] API versiyon tespit edildi: ${version}`);
        return version;
      }
    } catch {
      // Sonraki versiyonu dene
    }
  }

  console.warn('[protector] API versiyon tespit edilemedi, varsayilan: 7.1');
  resolvedApiVersion = '7.1';
  return resolvedApiVersion;
}

/**
 * Protector'a giris yapar, session cookie doner.
 */
async function authenticate(host, port, username, password, acceptSelfSigned = false) {
  const apiVersion = await detectApiVersion(host, port, acceptSelfSigned);
  const client = createClient(host, port, acceptSelfSigned);
  const loginUrl = `/API/${apiVersion}/master/UIController/services/Users/actions/login/invoke`;

  console.log(`[protector] Giris yapiliyor: ${host}:${port}`);

  try {
    const response = await client.post(
      loginUrl,
      `username=${encodeURIComponent(username)}&password=${encodeURIComponent(password)}&space=master`,
      { headers: { 'Content-Type': 'application/x-www-form-urlencoded' } }
    );

    const setCookies = response.headers['set-cookie'];
    if (!setCookies || setCookies.length === 0) {
      throw new Error('Giris basarili ancak oturum cookie donmedi.');
    }

    const cookieString = setCookies.map((c) => c.split(';')[0]).join('; ');
    cachedCookie = cookieString;
    sessionExpiresAt = Date.now() + SESSION_TIMEOUT_MS;

    console.log(`[protector] Giris basarili.`);
    return cookieString;
  } catch (err) {
    const sslErrors = [
      'UNABLE_TO_VERIFY_LEAF_SIGNATURE',
      'DEPTH_ZERO_SELF_SIGNED_CERT',
      'SELF_SIGNED_CERT_IN_CHAIN',
    ];
    if (sslErrors.includes(err.code)) {
      throw new Error(
        `SSL sertifika hatasi: ${err.code}. "Kendinden Imzali Sertifika Kabul Et" secenegini etkinlestirin.`
      );
    }
    if (err.response?.status === 401 || err.response?.status === 403) {
      throw new Error(`Kullanici adi veya sifre hatali. (HTTP ${err.response.status})`);
    }
    if (err.response?.status === 404) {
      throw new Error(`Login endpoint bulunamadi (404). API versiyonu: ${apiVersion}`);
    }

    const detail = err.response?.status
      ? `HTTP ${err.response.status}`
      : err.code || err.message;
    throw new Error(`Protector giris basarisiz: ${detail}`);
  }
}

/**
 * Gecerli oturum cookie doner, gerektigi zaman yeniden giris yapar.
 */
async function getSession(host, port, username, password, acceptSelfSigned) {
  if (cachedCookie && Date.now() < sessionExpiresAt) {
    return cachedCookie;
  }
  return authenticate(host, port, username, password, acceptSelfSigned);
}

/**
 * Protector API'ye authenticated GET istegi yapar.
 */
async function authenticatedGet(host, port, cookie, path, acceptSelfSigned = false) {
  const client = createClient(host, port, acceptSelfSigned);
  const response = await client.get(path, {
    headers: { Cookie: cookie },
  });
  return response.data;
}

/**
 * Protector uzerinden depolama ve replikasyon bilgilerini kesfeder.
 *
 * Endpoint'ler:
 *   1. Nodes    → Depolama sistemleri (NodeManager/objects/Nodes)
 *   2. DataFlows → Replikasyonlar (DataFlowHandler/objects/DataFlows)
 *   3. RPO      → RPO durumu (ReportHandler/objects/RPOS/Current/collections/entries)
 *
 * @returns {Promise<Object>} { storages, replications, rpoStatus, errors }
 */
async function discoverFromProtector(host, port, cookie, acceptSelfSigned = false) {
  const apiVersion = resolvedApiVersion || '7.1';

  const results = {
    storages: [],
    replications: [],
    rpoStatus: [],
    errors: [],
  };

  // 1. Depolama sistemlerini al (Nodes)
  try {
    const url = `/API/${apiVersion}/master/NodeManager/objects/Nodes`;
    const data = await authenticatedGet(host, port, cookie, url, acceptSelfSigned);
    const nodes = data?.node || data?.nodes || [];
    if (Array.isArray(nodes) && nodes.length > 0) {
      results.storages = nodes;
      console.log(`[protector] ${nodes.length} depolama sistemi bulundu.`);
    }
  } catch (err) {
    results.errors.push({ endpoint: 'Depolama Sistemleri', error: err.message });
  }

  // 2. Replikasyonlari al (DataFlows)
  try {
    const url = `/API/${apiVersion}/master/DataFlowHandler/objects/DataFlows`;
    const data = await authenticatedGet(host, port, cookie, url, acceptSelfSigned);
    const flows = data?.dataFlow || data?.dataFlows || [];
    if (Array.isArray(flows) && flows.length > 0) {
      results.replications = flows;
      console.log(`[protector] ${flows.length} replikasyon bulundu.`);
    }
  } catch (err) {
    results.errors.push({ endpoint: 'Replikasyonlar', error: err.message });
  }

  // 3. RPO durumunu al
  try {
    const url = `/API/${apiVersion}/master/ReportHandler/objects/RPOS/Current/collections/entries`;
    const data = await authenticatedGet(host, port, cookie, url, acceptSelfSigned);
    const entries = data?.rPOReportEntry || data?.entries || [];
    if (Array.isArray(entries) && entries.length > 0) {
      results.rpoStatus = entries;
      console.log(`[protector] ${entries.length} RPO durumu bulundu.`);
    }
  } catch (err) {
    results.errors.push({ endpoint: 'RPO Durumu', error: err.message });
  }

  if (results.storages.length === 0 && results.replications.length === 0 && results.rpoStatus.length === 0) {
    console.warn('[protector] Protector uzerinden veri bulunamadi.');
  }

  return results;
}

/**
 * Protector baglantisini test eder: giris + kesif.
 */
async function testConnection(host, port, username, password, acceptSelfSigned = false) {
  try {
    const cookie = await authenticate(host, port, username, password, acceptSelfSigned);
    const discovery = await discoverFromProtector(host, port, cookie, acceptSelfSigned);

    return {
      success: true,
      authenticated: true,
      apiVersion: resolvedApiVersion,
      storagesFound: discovery.storages.length,
      replicationsFound: discovery.replications.length,
      rpoStatusCount: discovery.rpoStatus.length,
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
 * Oturumu kapatir.
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
    // Logout hatalari yoksay
  }

  cachedCookie = null;
  sessionExpiresAt = 0;
}

/**
 * Oturum cache'ini temizler (logout yapmadan).
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
  discoverFromProtector,
  testConnection,
  logout,
  clearSessionCache,
};
