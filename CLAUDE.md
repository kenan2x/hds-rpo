# Hitachi VSP E1090 — 3DC RPO Monitor

## Project Overview

A web-based monitoring dashboard that connects to Hitachi Ops Center REST API (Configuration Manager) to monitor RPO (Recovery Point Objective) for 3DC (Three Data Center) Universal Replicator replication environments. The application auto-discovers storage systems, 3DC pairs, consistency groups, and calculates RPO using two complementary methods.

**Target deployment:** Docker container (Linux)

---

## Tech Stack

- **Frontend:** React (Vite) with Tailwind CSS
- **Backend:** Node.js (Express) or Python (FastAPI) — choose whichever produces cleaner async HTTP handling
- **Database:** SQLite for storing configuration, credentials (encrypted), and historical RPO data points
- **Containerization:** Docker with multi-stage build, final image based on a lightweight Linux distro

---

## Architecture

```
┌─────────────────────────────────────────────┐
│              Browser (React SPA)             │
│  Login → API Config → Storage Auth → Dashboard │
└──────────────────┬──────────────────────────┘
                   │ REST
┌──────────────────▼──────────────────────────┐
│            Backend API Server                │
│  - Auth & session management                 │
│  - Ops Center API proxy & polling            │
│  - RPO calculation engine                    │
│  - Historical data storage (SQLite)          │
└──────────────────┬──────────────────────────┘
                   │ HTTPS
┌──────────────────▼──────────────────────────┐
│     Hitachi Ops Center REST API              │
│     (Configuration Manager)                  │
│     Single endpoint, multiple storages       │
└─────────────────────────────────────────────┘
```

---

## User Flow (Step by Step)

### 1. Application Login
- First screen: username + password form for the application itself
- This is the LOCAL app login, not Hitachi credentials
- Default admin account on first run (admin/admin), force password change
- JWT-based session

### 2. Ops Center API Configuration
After login, user configures the Ops Center API connection:
- **API Host/IP** (e.g., `192.168.1.100`)
- **Port** (default: `23451`)
- **SSL toggle** (default: on, with option to accept self-signed certs)

### 3. Storage Discovery & Per-Storage Authentication
**CRITICAL:** There is ONE Ops Center API endpoint, but EACH storage system has DIFFERENT credentials.

Flow:
1. App calls `GET /ConfigurationManager/v1/objects/storages` to discover all registered storage systems
2. Display discovered storages in a list/table showing: storage device ID, model, serial number
3. User enters username + password for EACH storage separately
4. App validates each credential by creating a test session (`POST .../sessions`) and immediately discarding it
5. Store validated credentials (encrypted) in SQLite

**Storage Device ID format for E1090:** `938000` + 6-digit serial number (zero-padded). Example: serial `412345` → `938000412345`

### 4. Auto-Discovery of 3DC Pairs & Consistency Groups
For each authenticated storage:
1. Create sessions on both local and remote storage systems
2. Call `GET .../remote-mirror-copygroups?remoteStorageDeviceId={remoteId}&detailInfoType=pair` 
3. Filter for `replicationType: "UR"` (Universal Replicator) pairs
4. Group pairs by `consistencyGroupId`
5. Present discovered consistency groups and their member volumes

The user should be able to:
- See all auto-discovered consistency groups
- Optionally create custom monitoring groups by selecting specific volumes
- Enable/disable monitoring per group

### 5. RPO Dashboard
Main monitoring view showing:
- **Group-level RPO** (aggregated from worst-case volume in the group)
- **Volume-level RPO** (expandable per group, drill-down)
- **Two RPO methods side by side** (see RPO Calculation section)
- **Historical RPO trend** (line chart over time)
- **Status indicators** (green/yellow/red based on configurable thresholds)
- **Auto-refresh** with configurable interval (default: 5 minutes)

---

## Hitachi REST API Integration

### Base URL Format
```
https://{host}:{port}/ConfigurationManager/v1/objects/storages/{storageDeviceId}
```

### Authentication — Session-Based

**Creating a session:**
```
POST /ConfigurationManager/v1/objects/storages/{storageDeviceId}/sessions
Header: Authorization: Basic {base64(username:password)}
Body: { "aliveTime": 300 }
Response: { "token": "...", "sessionId": 3 }
```

After session creation, use token in subsequent requests:
```
Authorization: Session {token}
```

**CRITICAL for remote copy operations:** Two sessions needed — one for local storage, one for remote storage. Both tokens must be sent:
```
Authorization: Session {localToken}
Remote-Authorization: Session {remoteToken}
```

**Session lifecycle:**
- Default timeout: 300 seconds
- Remote sessions: minimum 60 seconds aliveTime (required by API)
- Maximum 64 concurrent sessions per storage
- Send periodic requests to keep sessions alive
- Always DELETE sessions when done

### API Endpoints Used

#### 1. List Storage Systems
```
GET /ConfigurationManager/v1/objects/storages
```
Returns all registered storage systems with their device IDs.

#### 2. Refresh Cache (call before reading data)
```
PUT /ConfigurationManager/v1/views/actions/refresh/invoke
Header: Authorization: Session {token}
```

#### 3. Journal Information (PRIMARY RPO DATA SOURCE)
```
GET .../storages/{storageDeviceId}/journals?journalInfo=basic
GET .../storages/{storageDeviceId}/journals?journalInfo=detail
GET .../storages/{storageDeviceId}/journals?journalInfo=timer
```

**Key response fields for RPO (basic):**
```json
{
  "journalId": 0,
  "muNumber": 1,
  "consistencyGroupId": 5,
  "journalStatus": "PJNN",
  "numOfActivePaths": 2,
  "usageRate": 6,
  "qMarker": "575cc653",
  "qCount": 1465528,
  "byteFormatCapacity": "3.87 T",
  "blockCapacity": 3956736,
  "numOfLdevs": 1,
  "firstLdevId": 513
}
```

**Key response fields for RPO (detail):**
```json
{
  "journalId": 1,
  "isMainframe": false,
  "isCacheModeEnabled": true,
  "isInflowControlEnabled": false,
  "dataOverflowWatchInSeconds": 0,
  "copySpeed": 256,
  "isDataCopying": true,
  "mpBladeId": 1,
  "mirrorUnits": [
    {
      "muNumber": 2,
      "consistencyGroupId": 2,
      "journalStatus": "PJNN",
      "pathBlockadeWatchInMinutes": 5,
      "copyPace": "M",
      "copySpeed": 256,
      "isDataCopying": true
    }
  ]
}
```

**IMPORTANT for 3DC:** A journal can have multiple MUs (Mirror Units). In a 3DC setup, not all MUs are active. Only MUs with `journalStatus != "SMPL"` are actively used. When querying a specific journal ID, only one MU is returned — always use the list endpoint to get all MUs.

#### 4. Remote Copy Groups (pair status)
```
GET .../storages/{storageDeviceId}/remote-mirror-copygroups?remoteStorageDeviceId={remoteId}&detailInfoType=pair
Headers:
  Authorization: Session {localToken}
  Remote-Authorization: Session {remoteToken}
```

**Key response fields:**
```json
{
  "copyGroupName": "remoteCopyGroup2",
  "copyPairs": [{
    "replicationType": "UR",
    "pvolLdevId": 1569,
    "pvolJournalId": 13,
    "svolLdevId": 2835,
    "svolJournalId": 36,
    "fenceLevel": "ASYNC",
    "pvolStatus": "PAIR",
    "svolStatus": "PAIR",
    "consistencyGroupId": 10,
    "copyProgressRate": null
  }]
}
```

With `detailInfoType=class`, additional fields are returned:
- `transitionStatus`: None / Suspending / Deleting
- `deltaStatus`: HOLD (normal) / HLDE (failed) / HOLDING (transitioning) — important for 3DC delta resync

#### 5. Direct Pair Query (alternative, no copy group needed)
```
GET .../storages/{storageDeviceId}/remote-copypairs?replicationType=UR&headLdevId=0&count=500
Header: Authorization: Session {token}
```

Pagination: default returns 500 pairs from LDEV 0. Use `headLdevId` and `count` for paging.

#### 6. LDEV Information (for numOfUsedBlock method)
```
GET .../storages/{storageDeviceId}/ldevs/{ldevId}
```

Key field: `numOfUsedBlock` — number of used blocks in a thin-provisioned volume.

---

## RPO Calculation — Two Methods

### Method 1: Journal-Based (qMarker + qCount + usageRate) — PRIMARY METHOD

This is the accurate method that captures ALL data changes including overwrites.

**How it works:**
- `qMarker`: Hex sequence number. Master journal records the last write; restore journal records the last applied write.
- `qCount`: Number of pending entries in the master journal waiting to be sent to DR.
- `usageRate`: Percentage of journal capacity holding unsent data. Integer (rounded), so precision is limited.
- `byteFormatCapacity`: Total journal volume size.

**RPO indicators:**
- **Pending data (approx):** `byteFormatCapacity × usageRate / 100`
- **Pending entries:** `qCount` value directly
- **Transfer time estimate:** `pending_data_bytes / (copySpeed_mbps × 1024 × 1024 / 8)` seconds
- **qMarker delta:** Convert hex to decimal, subtract DR from Prod. Smaller = better.
- **Trend:** Compare qCount/usageRate over time. Increasing = RPO growing. Stable = RPO steady. Decreasing = DR catching up.

**Display:**
- Show pending data in human-readable format (GB/TB)
- Show estimated RPO time based on copySpeed
- Show qCount trend (sparkline or mini chart)
- Color code: Green (usageRate < 5%), Yellow (5-20%), Red (> 20%)

**IMPORTANT NOTE on usageRate:** This is an integer, so for large journals (e.g., 3.87 TB), each 1% = ~39 GB. The resolution is very coarse. Use qCount and qMarker delta for more precise trending.

### Method 2: LDEV numOfUsedBlock Comparison — SUPPLEMENTARY METHOD

Compares used block count between primary and DR volumes.

**How it works:**
- Query `numOfUsedBlock` for each primary LDEV and its corresponding DR LDEV
- Calculate the difference in blocks
- Convert to human-readable size (block size = 512 bytes typically, but verify)

**Limitations (MUST be shown in UI):**
- Only detects NEW block allocations (new writes to previously unused space)
- Does NOT detect overwrites to existing blocks
- Useful for: storage vMotion tracking, initial copy progress, new VM provisioning
- NOT useful for: database overwrites, log rotation, general RPO measurement

**Display:**
- Show as "Block Allocation Delta" or "Yeni Alan Farkı" — NOT as "RPO"
- Clearly label this as supplementary / initial-copy tracking
- Show per-volume and aggregated per-group

---

## Journal Status Reference

Display these in the UI with color coding:

| Status | Meaning | Severity | Color |
|--------|---------|----------|-------|
| SMPL | Mirror not in use | Info | Gray |
| P(S)JNN | Normal | OK | Green |
| P(S)JSN | Normal split | Warning | Yellow |
| P(S)JNF | Journal full | High | Orange |
| P(S)JSF | Journal full + split | Critical | Red |
| P(S)JSE | Error split (link failure) | Critical | Red |
| P(S)JNS | Normal split (3DC delta resync) | Warning | Yellow |
| P(S)JES | Error split (3DC delta resync) | Critical | Red |

## Pair Status Reference

| Status | Meaning | RPO Impact |
|--------|---------|------------|
| PAIR | Normal replication | RPO is the journal lag |
| COPY | Synchronizing (initial or resync) | RPO = all uncopied data |
| PSUS | Primary suspended | RPO growing, no replication |
| SSUS | Secondary suspended | RPO growing, no replication |
| PSUE | Suspended due to error | Critical — RPO growing |
| SSWS | S-VOL writable after takeover | DR is active, check carefully |

---

## Dashboard UI Design

### Layout
```
┌─────────────────────────────────────────────────────┐
│  Header: App Name | Last Refresh | Auto-refresh ⟳   │
├─────────────────────────────────────────────────────┤
│                                                     │
│  ┌─ Consistency Group: CG-5 ──────────────────────┐ │
│  │  Status: ● NORMAL    Journal: PJNN             │ │
│  │                                                 │ │
│  │  ┌─ Method 1: Journal RPO ─┐ ┌─ Method 2 ────┐│ │
│  │  │ Pending: 232 GB         │ │ Block Delta:   ││ │
│  │  │ Est. Time: ~124 min     │ │ 5.2 GB         ││ │
│  │  │ qCount: 1,465,528       │ │ (yeni alan)    ││ │
│  │  │ Trend: ↓ decreasing     │ │                ││ │
│  │  └─────────────────────────┘ └────────────────┘│ │
│  │                                                 │ │
│  │  ┌─ RPO Trend Chart (24h) ────────────────────┐│ │
│  │  │  [sparkline / line chart]                   ││ │
│  │  └────────────────────────────────────────────┘│ │
│  │                                                 │ │
│  │  ▶ Volumes (click to expand)                    │ │
│  │    LDEV 1569 → 2835  PAIR  qCount: 500         │ │
│  │    LDEV 1570 → 2836  PAIR  qCount: 320         │ │
│  │    LDEV 1571 → 2837  COPY  Progress: 45%       │ │
│  └─────────────────────────────────────────────────┘ │
│                                                     │
│  ┌─ Consistency Group: CG-10 ─────────────────────┐ │
│  │  ...                                            │ │
│  └─────────────────────────────────────────────────┘ │
└─────────────────────────────────────────────────────┘
```

### Color Scheme
- Use a professional dark-blue / white theme suitable for NOC/operations
- Status colors: Green (#22C55E), Yellow (#EAB308), Orange (#F97316), Red (#EF4444), Gray (#6B7280)
- Cards with subtle shadows, rounded corners
- Clear visual hierarchy: Group > Method > Volume

### Key UI Components
1. **Connection status bar** — shows Ops Center connectivity, session status per storage
2. **Group cards** — one per consistency group, collapsible
3. **RPO gauges or indicators** — visual representation of RPO health
4. **Trend charts** — 1h / 6h / 24h / 7d selectable timeframes
5. **Alert log** — shows status changes, threshold breaches
6. **Settings page** — API config, storage credentials, refresh interval, RPO thresholds

---

## Polling & Data Collection

### Background Polling Service
- Configurable interval (default: 5 minutes, minimum: 1 minute)
- On each poll cycle:
  1. Refresh cache on each storage (`PUT .../views/actions/refresh/invoke`)
  2. Query journal info (basic + detail) for all relevant journals
  3. Query remote copy pair status
  4. Query LDEV info for numOfUsedBlock comparison
  5. Calculate RPO metrics
  6. Store data point in SQLite with timestamp
  7. Check thresholds, generate alerts if breached
- Session management: maintain persistent sessions, renew before timeout
- Handle errors gracefully: if one storage is unreachable, continue monitoring others

### Data Retention
- Raw data points: keep 30 days, then downsample to hourly averages
- Configurable retention period in settings

---

## Docker Configuration

### Dockerfile (multi-stage)
```dockerfile
# Stage 1: Build frontend
FROM node:20-alpine AS frontend-build
WORKDIR /app/frontend
COPY frontend/package*.json ./
RUN npm ci
COPY frontend/ ./
RUN npm run build

# Stage 2: Build backend + final image
FROM node:20-alpine  # or python:3.12-slim if using Python
WORKDIR /app
COPY backend/package*.json ./
RUN npm ci --production
COPY backend/ ./
COPY --from=frontend-build /app/frontend/dist ./public
EXPOSE 3000
CMD ["node", "server.js"]
```

### docker-compose.yml
```yaml
version: '3.8'
services:
  rpo-monitor:
    build: .
    ports:
      - "3000:3000"
    volumes:
      - rpo-data:/app/data  # SQLite + config persistence
    environment:
      - NODE_ENV=production
      - ENCRYPTION_KEY=${ENCRYPTION_KEY}  # for credential encryption
    restart: unless-stopped
volumes:
  rpo-data:
```

### Important Docker Notes
- SQLite database file must be on a persistent volume
- Encryption key for stored credentials should come from environment variable
- Support `HTTPS_REJECT_UNAUTHORIZED=0` env var for self-signed certs on Ops Center
- Health check endpoint: `GET /api/health`
- Log to stdout for Docker log collection

---

## Security Considerations

- All stored Hitachi credentials must be encrypted at rest (AES-256 or similar)
- Application passwords hashed with bcrypt
- HTTPS recommended for the application itself (provide option for TLS certs)
- API tokens/sessions never exposed to frontend — backend proxies all Hitachi API calls
- Session timeout for the web UI: configurable, default 30 minutes

---

## Error Handling

- If Ops Center API is unreachable: show last known data with "stale" indicator and timestamp
- If individual storage session fails: show error for that storage, continue others
- If pair count exceeds ~1200: the API may not return remote-side info. In this case, query both REST API servers separately and merge results (per Hitachi documentation)
- Handle HTTP 500 from async job registration failures
- Retry logic: 3 retries with exponential backoff for transient failures

---

## File Structure

```
hitachi-rpo-monitor/
├── CLAUDE.md                    # This file
├── docker-compose.yml
├── Dockerfile
├── frontend/
│   ├── package.json
│   ├── vite.config.js
│   ├── tailwind.config.js
│   ├── src/
│   │   ├── App.jsx
│   │   ├── main.jsx
│   │   ├── pages/
│   │   │   ├── Login.jsx
│   │   │   ├── Setup.jsx         # API config + storage auth
│   │   │   ├── Dashboard.jsx     # Main monitoring view
│   │   │   └── Settings.jsx      # Configuration management
│   │   ├── components/
│   │   │   ├── GroupCard.jsx      # Consistency group card
│   │   │   ├── VolumeTable.jsx    # Volume detail table
│   │   │   ├── RpoGauge.jsx      # Visual RPO indicator
│   │   │   ├── TrendChart.jsx    # Historical RPO chart
│   │   │   ├── StatusBadge.jsx   # Journal/pair status badge
│   │   │   └── AlertLog.jsx      # Alert history
│   │   ├── hooks/
│   │   │   └── usePolling.js     # Auto-refresh hook
│   │   └── utils/
│   │       └── formatters.js     # Data formatting helpers
│   └── public/
├── backend/
│   ├── package.json
│   ├── server.js                 # Express app entry
│   ├── routes/
│   │   ├── auth.js               # App login/logout
│   │   ├── config.js             # API config CRUD
│   │   ├── storages.js           # Storage discovery & auth
│   │   ├── monitoring.js         # RPO data endpoints
│   │   └── alerts.js             # Alert configuration
│   ├── services/
│   │   ├── hitachiApi.js         # Ops Center REST API client
│   │   ├── sessionManager.js     # Hitachi session lifecycle
│   │   ├── rpoCalculator.js      # RPO calculation engine
│   │   ├── poller.js             # Background polling service
│   │   └── discovery.js          # 3DC pair auto-discovery
│   ├── models/
│   │   └── database.js           # SQLite schema & queries
│   └── utils/
│       └── encryption.js         # Credential encryption
└── data/                         # SQLite DB (Docker volume)
    └── rpo-monitor.db
```

---

## Language / Localization

The UI should be in **Turkish** since this is for a Turkish operations team. Key translations:
- RPO = RPO (keep as-is)
- Consistency Group = Tutarlılık Grubu
- Journal Status = Journal Durumu
- Pending Data = Bekleyen Veri
- Estimated Time = Tahmini Süre
- Block Allocation Delta = Blok Tahsis Farkı
- Settings = Ayarlar
- Refresh = Yenile
- Storage Systems = Depolama Sistemleri
- Replication = Replikasyon
- Alert = Uyarı
- Threshold = Eşik Değeri
