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
 * API yanıtından dizi çıkarır. Bilinen anahtar isimlerini dener,
 * bulamazsa yanıttaki ilk diziyi kullanır.
 * rawKeys: yanıttaki tüm üst-düzey anahtarlar (debug için).
 */
function extractArray(data, knownKeys) {
  if (!data || typeof data !== 'object') return { items: [], foundKey: null, rawKeys: [] };

  const rawKeys = Object.keys(data);

  // Bilinen anahtarları dene
  for (const key of knownKeys) {
    if (Array.isArray(data[key]) && data[key].length > 0) {
      return { items: data[key], foundKey: key, rawKeys };
    }
  }

  // Bilinen anahtar bulunamadı — yanıtın kendisi bir dizi mi?
  if (Array.isArray(data) && data.length > 0) {
    return { items: data, foundKey: '(root array)', rawKeys: ['(root array)'] };
  }

  // Yanıttaki ilk diziyi bul
  for (const key of rawKeys) {
    if (Array.isArray(data[key]) && data[key].length > 0) {
      return { items: data[key], foundKey: key, rawKeys };
    }
  }

  // Hiç dizi bulunamadı — tek nesne olabilir, onu da diziye sar
  // (pageInfo gibi meta alanlarını hariç tut)
  const metaKeys = ['pageInfo', 'count', 'total', 'offset', 'limit'];
  const dataKeys = rawKeys.filter((k) => !metaKeys.includes(k));
  if (dataKeys.length === 1 && typeof data[dataKeys[0]] === 'object' && !Array.isArray(data[dataKeys[0]])) {
    return { items: [data[dataKeys[0]]], foundKey: dataKeys[0], rawKeys };
  }

  return { items: [], foundKey: null, rawKeys };
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
    const extracted = extractArray(data, ['node', 'nodes']);
    results.storages = extracted.items;
    results.storagesRawKeys = extracted.rawKeys;
    if (extracted.items.length > 0) {
      console.log(`[protector] ${extracted.items.length} depolama sistemi bulundu (key: ${extracted.foundKey}).`);
    } else {
      console.log(`[protector] Nodes endpointi bos dondu. Anahtarlar: ${extracted.rawKeys.join(', ')}`);
    }
  } catch (err) {
    results.errors.push({ endpoint: 'Depolama Sistemleri (Nodes)', error: err.message });
  }

  // 2. Replikasyonlari al (DataFlows)
  try {
    const url = `/API/${apiVersion}/master/DataFlowHandler/objects/DataFlows`;
    const data = await authenticatedGet(host, port, cookie, url, acceptSelfSigned);
    const extracted = extractArray(data, ['dataFlow', 'dataFlows', 'data']);
    results.replications = extracted.items;
    results.replicationsRawKeys = extracted.rawKeys;
    if (extracted.items.length > 0) {
      console.log(`[protector] ${extracted.items.length} replikasyon bulundu (key: ${extracted.foundKey}).`);
    } else {
      console.log(`[protector] DataFlows endpointi bos dondu. Anahtarlar: ${extracted.rawKeys.join(', ')}`);
    }
  } catch (err) {
    results.errors.push({ endpoint: 'Replikasyonlar (DataFlows)', error: err.message });
  }

  // 3. RPO durumunu al
  try {
    const url = `/API/${apiVersion}/master/ReportHandler/objects/RPOS/Current/collections/entries`;
    const data = await authenticatedGet(host, port, cookie, url, acceptSelfSigned);
    const extracted = extractArray(data, ['rPOReportEntry', 'entries', 'rpoReport']);
    results.rpoStatus = extracted.items;
    results.rpoStatusRawKeys = extracted.rawKeys;
    if (extracted.items.length > 0) {
      console.log(`[protector] ${extracted.items.length} RPO durumu bulundu (key: ${extracted.foundKey}).`);
    } else {
      console.log(`[protector] RPO endpointi bos dondu. Anahtarlar: ${extracted.rawKeys.join(', ')}`);
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
 * Ham Protector verisinden topoloji haritası çıkarır.
 *
 * Nodes listesinden storage'ları filtreler,
 * DataFlows'dan connections ile kaynak→hedef bağlantılarını çözer,
 * RPO Status'tan durum bilgisini eşler.
 *
 * @returns {Object} { storageNodes, dataFlows, topology }
 */
function parseTopology(storages, replications, rpoStatus) {
  // 1. Node haritası: id → { name, type, accessible, ... }
  const nodeMap = {};
  const storageNodes = [];

  for (const node of storages) {
    nodeMap[node.id] = {
      id: node.id,
      name: node.name,
      type: node.type,
      resourceId: node.resourceId,
      accessible: node.stateInfo?.accessible ?? null,
      connected: node.stateInfo?.connected ?? null,
      authorized: node.stateInfo?.authorized ?? null,
    };
    // Sadece storage tipleri
    if (node.type === 'HardwareNodeBlock' || node.type === 'HitachiVirtualStoragePlatform') {
      storageNodes.push(nodeMap[node.id]);
    }
  }

  // 2. DataFlow'ları parse et
  const dataFlows = [];

  for (const flow of replications) {
    const flowNodes = flow.data?.nodes || [];
    const flowConnections = flow.data?.connections || [];

    // DataFlow içindeki node id → nodeId eşlemesi
    const flowNodeMap = {};
    for (const fn of flowNodes) {
      flowNodeMap[fn.id] = {
        flowNodeId: fn.id,
        nodeId: fn.nodeId, // Ana Nodes listesindeki id
        type: fn.type,
        isDestination: fn.isDestination,
        isGroup: fn.isGroup,
        // Ana node bilgisini eşle
        name: nodeMap[fn.nodeId]?.name || fn.nodeId,
        nodeType: nodeMap[fn.nodeId]?.type || 'unknown',
      };
    }

    // Connection'ları çöz: source/destination → gerçek node isimleri
    const connections = flowConnections.map((conn) => {
      const src = flowNodeMap[conn.source] || { name: conn.source, nodeType: 'unknown' };
      const dst = flowNodeMap[conn.destination] || { name: conn.destination, nodeType: 'unknown' };
      return {
        id: conn.id,
        label: conn.label || '',
        type: conn.type,
        sourceName: src.name,
        sourceType: src.nodeType,
        sourceNodeId: src.nodeId,
        destinationName: dst.name,
        destinationType: dst.nodeType,
        destinationNodeId: dst.nodeId,
      };
    });

    dataFlows.push({
      id: flow.id,
      name: flow.data?.name || flow.data?.description || flow.id,
      isActive: flow.isActive,
      activatedDate: flow.activatedDate,
      numInError: flow.numInError || 0,
      numInProgress: flow.numInProgress || 0,
      numOffline: flow.numOffline || 0,
      connections,
      nodeCount: flowNodes.length,
    });
  }

  // 3. RPO Status eşle
  const rpoEntries = rpoStatus.map((entry) => ({
    id: entry.id,
    dataFlowId: entry.dataFlow?.id,
    dataFlowName: entry.dataFlow?.name,
    status: entry.status,
    moverType: entry.moverType,
    lastBackup: entry.lastBackup,
    sourceNodeId: entry.sourceNode?.id,
    destinationNodeId: entry.destinationNode?.id,
    sourceName: nodeMap[entry.sourceNode?.id]?.name || entry.sourceNode?.id,
    destinationName: nodeMap[entry.destinationNode?.id]?.name || entry.destinationNode?.id,
    policyName: entry.policy?.name,
    operationName: entry.policy?.operation?.name,
    operationType: entry.policy?.operation?.type,
    rpoUnits: entry.policy?.operation?.rpo?.units,
  }));

  return { storageNodes, dataFlows, rpoEntries };
}

/**
 * Protector baglantisini test eder: giris + kesif + topoloji parse.
 */
async function testConnection(host, port, username, password, acceptSelfSigned = false) {
  try {
    const cookie = await authenticate(host, port, username, password, acceptSelfSigned);
    const discovery = await discoverFromProtector(host, port, cookie, acceptSelfSigned);

    // Topolojiyi parse et
    const topology = parseTopology(
      discovery.storages,
      discovery.replications,
      discovery.rpoStatus
    );

    return {
      success: true,
      authenticated: true,
      apiVersion: resolvedApiVersion,
      // Parse edilmiş topoloji
      storageNodes: topology.storageNodes,
      dataFlows: topology.dataFlows,
      rpoEntries: topology.rpoEntries,
      // Ham veri sayıları
      rawCounts: {
        totalNodes: discovery.storages.length,
        totalDataFlows: discovery.replications.length,
        totalRpoEntries: discovery.rpoStatus.length,
      },
      errors: discovery.errors,
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
