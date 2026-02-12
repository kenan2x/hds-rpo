# Hitachi VSP E1090 — 3DC RPO Monitor

Hitachi Ops Center REST API (Configuration Manager) ile entegre, 3DC (Three Data Center) Universal Replicator replikasyon ortamlarını izleyen web tabanlı RPO (Recovery Point Objective) monitoring dashboard.

![Node.js](https://img.shields.io/badge/Node.js-20-green)
![React](https://img.shields.io/badge/React-19-blue)
![Docker](https://img.shields.io/badge/Docker-ready-blue)
![License](https://img.shields.io/badge/License-MIT-yellow)

---

## Özellikler

- **Otomatik Keşif** — Ops Center API üzerinden depolama sistemlerini, 3DC pair'lerini ve tutarlılık gruplarını otomatik keşfeder
- **İki RPO Hesaplama Yöntemi**
  - **Journal Bazlı (Birincil)** — qMarker, qCount ve usageRate ile tüm veri değişikliklerini (overwrite dahil) yakalar
  - **Blok Tahsis Farkı (Tamamlayıcı)** — numOfUsedBlock karşılaştırması ile yeni blok tahsislerini izler
- **Gerçek Zamanlı Dashboard** — Tutarlılık grubu bazında RPO durumu, trend grafikleri, hacim detayları
- **Uyarı Sistemi** — Yapılandırılabilir eşik değerleri ile otomatik uyarı üretimi
- **Geçmiş Verileri** — SQLite ile 30 günlük RPO geçmişi, trend analizi
- **Türkçe Arayüz** — Operasyon ekipleri için tamamen Türkçe kullanıcı arayüzü
- **Docker Desteği** — Tek komutla kurulum ve çalıştırma

---

## Mimari

```
┌─────────────────────────────────────────────┐
│              Tarayıcı (React SPA)           │
│  Giriş → API Yapılandırma → Dashboard      │
└──────────────────┬──────────────────────────┘
                   │ REST
┌──────────────────▼──────────────────────────┐
│            Backend API Sunucusu             │
│  - JWT kimlik doğrulama                     │
│  - Ops Center API proxy & yoklama           │
│  - RPO hesaplama motoru                     │
│  - Geçmiş veri depolama (SQLite)            │
└──────────────────┬──────────────────────────┘
                   │ HTTPS
┌──────────────────▼──────────────────────────┐
│     Hitachi Ops Center REST API             │
│     (Configuration Manager)                 │
└─────────────────────────────────────────────┘
```

---

## Hızlı Başlangıç (Docker)

```bash
docker run -d \
  --name rpo-monitor \
  -p 3000:3000 \
  -v rpo-data:/app/data \
  -e ENCRYPTION_KEY=your-32-char-encryption-key!! \
  -e JWT_SECRET=your-jwt-secret-here \
  kenankarakoc/hdsrpo:latest
```

Tarayıcıdan `http://localhost:3000` adresine gidin.

**Varsayılan giriş bilgileri:** `admin` / `admin` (ilk girişte şifre değiştirme zorunludur)

### Docker Compose ile

```bash
git clone https://github.com/kenan2x/hds-rpo.git
cd hds-rpo
cp .env.example .env
# .env dosyasındaki ENCRYPTION_KEY ve JWT_SECRET değerlerini güncelleyin
docker-compose up -d
```

---

## Geliştirme Ortamı

### Gereksinimler

- Node.js 20+
- npm 10+

### Kurulum

```bash
# Backend bağımlılıklarını yükle
cd backend
npm install

# Frontend bağımlılıklarını yükle
cd ../frontend
npm install
```

### Çalıştırma

```bash
# Terminal 1 - Backend (port 3000)
cd backend
ENCRYPTION_KEY=dev-encryption-key-32chars!! node server.js

# Terminal 2 - Frontend (port 5173, proxy → 3000)
cd frontend
npm run dev
```

Frontend geliştirme sunucusu `http://localhost:5173` adresinde çalışır ve `/api` isteklerini otomatik olarak backend'e yönlendirir.

---

## Kullanım Adımları

### 1. Giriş
Varsayılan `admin/admin` ile giriş yapın, ardından şifrenizi değiştirin.

### 2. Ops Center API Yapılandırması
- Ops Center sunucu adresi ve port bilgisini girin (varsayılan port: 23451)
- SSL ve self-signed sertifika ayarlarını yapılandırın
- Bağlantıyı test edin

### 3. Depolama Kimlik Doğrulama
- Keşfedilen depolama sistemleri listesini görüntüleyin
- Her depolama sistemi için ayrı kullanıcı adı/şifre girin ve doğrulayın

### 4. Tutarlılık Grupları
- Otomatik keşfedilen 3DC tutarlılık gruplarını görüntüleyin
- İzlemek istediğiniz grupları seçin

### 5. İzleme
- Dashboard üzerinden gerçek zamanlı RPO durumunu izleyin
- Trend grafikleri ile geçmiş verileri analiz edin
- Uyarıları takip edin

---

## Ortam Değişkenleri

| Değişken | Açıklama | Varsayılan |
|----------|----------|------------|
| `ENCRYPTION_KEY` | Hitachi kimlik bilgileri için AES-256 şifreleme anahtarı | (zorunlu) |
| `JWT_SECRET` | JWT token imzalama anahtarı | `default-secret-change-me` |
| `NODE_ENV` | Çalışma ortamı | `development` |
| `PORT` | Backend sunucu portu | `3000` |

---

## Proje Yapısı

```
hds-rpo/
├── CLAUDE.md                     # Proje spesifikasyonu
├── Dockerfile                    # Multi-stage Docker build
├── docker-compose.yml
├── frontend/
│   ├── src/
│   │   ├── App.jsx               # Ana uygulama, routing, auth context
│   │   ├── pages/
│   │   │   ├── Login.jsx         # Giriş sayfası
│   │   │   ├── Setup.jsx         # 3 adımlı kurulum sihirbazı
│   │   │   ├── Dashboard.jsx     # Ana izleme paneli
│   │   │   └── Settings.jsx      # Ayarlar sayfası
│   │   ├── components/
│   │   │   ├── GroupCard.jsx     # Tutarlılık grubu kartı
│   │   │   ├── VolumeTable.jsx   # Hacim detay tablosu
│   │   │   ├── RpoGauge.jsx     # SVG RPO göstergesi
│   │   │   ├── TrendChart.jsx   # Geçmiş trend grafiği
│   │   │   ├── StatusBadge.jsx  # Durum rozeti
│   │   │   └── AlertLog.jsx     # Uyarı geçmişi
│   │   ├── hooks/
│   │   │   └── usePolling.js    # Otomatik yenileme hook'u
│   │   └── utils/
│   │       └── formatters.js    # Türkçe formatlayıcılar
│   └── vite.config.js
├── backend/
│   ├── server.js                 # Express giriş noktası
│   ├── routes/
│   │   ├── auth.js              # JWT kimlik doğrulama
│   │   ├── config.js            # API yapılandırması
│   │   ├── storages.js          # Depolama keşfi ve auth
│   │   ├── monitoring.js        # RPO veri endpoint'leri
│   │   └── alerts.js            # Uyarı yönetimi
│   ├── services/
│   │   ├── hitachiApi.js        # Ops Center REST API istemcisi
│   │   ├── sessionManager.js    # Hitachi oturum yönetimi
│   │   ├── rpoCalculator.js     # RPO hesaplama motoru
│   │   ├── poller.js            # Arka plan yoklama servisi
│   │   └── discovery.js         # 3DC pair otomatik keşfi
│   ├── models/
│   │   └── database.js          # SQLite şeması ve sorgular
│   └── utils/
│       └── encryption.js        # AES-256-GCM şifreleme
└── data/                         # SQLite veritabanı (Docker volume)
```

---

## Journal Durum Referansı

| Durum | Açıklama | Önem | Renk |
|-------|----------|------|------|
| SMPL | Mirror kullanılmıyor | Bilgi | Gri |
| PJNN/SJNN | Normal | Normal | Yeşil |
| PJSN/SJSN | Normal bölünme | Uyarı | Sarı |
| PJNF/SJNF | Journal dolu | Yüksek | Turuncu |
| PJSF/SJSF | Journal dolu + bölünme | Kritik | Kırmızı |
| PJSE/SJSE | Hata bölünmesi (link arızası) | Kritik | Kırmızı |

## Pair Durum Referansı

| Durum | Açıklama | RPO Etkisi |
|-------|----------|------------|
| PAIR | Normal replikasyon | RPO = journal gecikmesi |
| COPY | Senkronizasyon (başlangıç/yeniden) | RPO = tüm kopyalanmamış veri |
| PSUS | Primary askıya alındı | RPO artıyor |
| SSUS | Secondary askıya alındı | RPO artıyor |
| PSUE | Hata nedeniyle askıya alındı | Kritik — RPO artıyor |
| SSWS | S-VOL yazılabilir (takeover sonrası) | DR aktif, dikkatli kontrol |

---

## Güvenlik

- Hitachi kimlik bilgileri AES-256-GCM ile şifreli saklanır
- Uygulama şifreleri bcrypt ile hash'lenir
- JWT tabanlı oturum yönetimi (30 dk varsayılan timeout)
- Backend tüm Hitachi API çağrılarını proxy eder — token'lar frontend'e açılmaz

---

## Lisans

MIT
