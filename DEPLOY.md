# استقرار P2PPay — Supabase + Fly.io

**خلاصه:** پایگاه‌داده (PostgreSQL) و فایل‌های احراز هویت (Storage) روی **Supabase** هستند. خود برنامه (API + وب اپ) یک
کانتینر Docker است که روی **Fly.io** در **بمبئی (bom)**، کنار پروژهٔ Supabase در همان منطقه، اجرا می‌شود.

> چرا API روی خود Supabase نیست؟ Edge Functions عمر کوتاه دارند و حلقهٔ بلاک‌چین (بررسی واریزها، ارسال برداشت‌ها، جمع‌آوری
> موجودی) باید همیشه روشن باشد. همچنین کیف‌پول داغ و کلید رمزگذاری باید فقط در یک سرور کنترل‌شده باشند.
> ورود و ثبت‌نام هم مال خود برنامه است (نه Supabase Auth)، چون 2FA، قفل حساب و سطح‌های KYC با پول کاربر گره خورده‌اند.

```
 کاربر ──HTTPS──► Fly.io (bom) ── Docker: Node API + وب اپ ──► Supabase (ap-south-1)
                     │                                          ├─ Postgres  (schema app, RLS روشن، بدون دسترسی anon)
                     └──► TronGrid (TRC20)                       └─ Storage   (باکت خصوصی kyc، فایل‌های رمزگذاری‌شده)
```

---

## 1. Supabase

1. در https://supabase.com/dashboard یک پروژه بسازید — **Region: South Asia (Mumbai) `ap-south-1`**. رمز قوی برای پایگاه‌داده بگذارید و در مدیر رمز نگه دارید.
2. **Connection string** (Project Settings → Database → Connect):
   - **Session pooler** (پورت **5432**): `postgresql://postgres.<ref>:<password>@aws-0-ap-south-1.pooler.supabase.com:5432/postgres`
   - یا **Direct connection**: `postgresql://postgres:<password>@db.<ref>.supabase.co:5432/postgres` (فقط IPv6؛ Fly.io IPv6 دارد).
   - ⚠️ **Transaction pooler (پورت 6543) را استفاده نکنید:** حلقهٔ بلاک‌چین با یک قفل سطح نشست (advisory lock) مطمئن می‌شود فقط یک نمونه اجرا شود.
3. **گواهی SSL** (Database Settings → SSL Configuration → Download certificate). محتوای آن را به‌صورت secret می‌گذاریم تا اتصال TLS تأییدشده باشد.
4. **Storage → New bucket:** نام `kyc`، **Public: خاموش**. فایل‌ها پیش از آپلود با AES-256-GCM رمزگذاری می‌شوند و فقط سرور با کلید سرویس به آن دسترسی دارد.
5. **کلید سرور** (Project Settings → API Keys): کلید `secret` (`sb_secret_…`) یا کلید قدیمی `service_role`. **هرگز در مرورگر یا مخزن نگذارید.**
6. **جدول‌ها:** لازم نیست دستی کاری کنید؛ مهاجرت‌ها (`supabase/migrations`) در هر deploy خودکار اجرا می‌شوند.
   اگر Supabase CLI دارید، `supabase db push` هم همین فایل‌ها را اعمال می‌کند و هر دو روش از یک جدول سابقه استفاده می‌کنند.
7. **امنیت پیشنهادی:**
   - چون همهٔ داده در schema خصوصی `app` است، در Settings → API → **Exposed schemas** فقط `public` بماند (یا Data API را خاموش کنید).
   - Database → Network restrictions: در صورت امکان فقط IPهای خروجی Fly.
   - **پشتیبان‌گیری:** پلن Pro پشتیبان روزانه دارد؛ برای پول واقعی **Point-in-Time Recovery** را فعال کنید.

## 2. Fly.io

```bash
curl -L https://fly.io/install.sh | sh
fly auth login
fly launch --no-deploy --copy-config --name p2ppay --region bom   # از fly.toml همین مخزن استفاده می‌کند
```

### رازها (secrets) — فقط اینجا، هرگز در فایل یا git

```bash
fly secrets set \
  DATABASE_URL='postgresql://postgres.<ref>:<password>@aws-0-ap-south-1.pooler.supabase.com:5432/postgres' \
  DATABASE_CA="$(cat prod-ca-2021.crt)" \
  SUPABASE_URL='https://<ref>.supabase.co' \
  SUPABASE_SERVICE_ROLE_KEY='sb_secret_…' \
  DATA_ENCRYPTION_KEY="$(node -e "console.log(require('crypto').randomBytes(32).toString('hex'))")" \
  ADMIN_USERNAME='…' ADMIN_PASSWORD='…' \
  TWILIO_ACCOUNT_SID='…' TWILIO_AUTH_TOKEN='…' TWILIO_FROM='+1…' \
  TRONGRID_API_KEY='…' \
  WALLET_MNEMONIC='…24 کلمه از npm run wallet:new…' \
  COLD_WALLET_ADDRESS='T…' \
  VAPID_PUBLIC_KEY='…' VAPID_PRIVATE_KEY='…' VAPID_SUBJECT='mailto:support@…'   # npx web-push generate-vapid-keys
```

- `DATA_ENCRYPTION_KEY` و `WALLET_MNEMONIC` را **جداگانه و آفلاین** پشتیبان بگیرید. گم شدن کلید رمزگذاری = غیرقابل‌خواندن شدن مدارک KYC و 2FA؛ گم شدن mnemonic = از دست رفتن دسترسی به آدرس‌های واریز.
- تا پایان بتا `TRON_NETWORK=nile` بماند (در `fly.toml`). برای mainnet: `fly secrets set TRON_NETWORK=mainnet TRON_MAINNET_CONFIRM=yes`.

### استقرار

```bash
fly deploy
```

- ابتدا `release_command` مهاجرت‌ها را روی Supabase اعمال می‌کند؛ فقط اگر موفق شد نسخهٔ جدید بالا می‌آید (rolling).
- بررسی سلامت: `GET /api/health` (اتصال به پایگاه‌داده را هم می‌سنجد).
- `auto_stop_machines = "off"` و `min_machines_running = 1`: حلقهٔ بلاک‌چین نباید خاموش شود.
- چند نمونه (`fly scale count 2`) امن است: تراکنش‌ها با قفل ردیف و به‌روزرسانی شرطی محافظت شده‌اند و حلقهٔ بلاک‌چین فقط روی نمونه‌ای اجرا می‌شود که قفل را دارد
  (`/api/health` → `chain.leader`). محدودیت نرخ درخواست فعلاً برای هر نمونه جداست.

### دامنه و HTTPS

```bash
fly certs add app.example.af
# رکورد DNS: CNAME app → p2ppay.fly.dev  (یا A/AAAA طبق خروجی دستور)
```

`COOKIE_SECURE=1` و HSTS از قبل در `fly.toml` روشن هستند.

## 3. محیط staging

همین مراحل با پروژهٔ Supabase جدا و اپ جدا:

```bash
fly launch --no-deploy --copy-config --name p2ppay-staging --region bom
fly secrets set -a p2ppay-staging DATABASE_URL=… # پروژهٔ Supabase مخصوص staging
fly deploy -a p2ppay-staging
```

هرگز staging و production یک پایگاه‌داده، یک mnemonic یا یک کلید رمزگذاری نداشته باشند.

## 4. CI

`.github/workflows/ci.yml` در هر push:

- تست‌های سرور دوبار: روی PGlite و روی **PostgreSQL 16 واقعی** (شامل تست‌های همزمانی)،
- اجرای دوبارهٔ مهاجرت‌ها (باید بدون خطا و بدون تغییر باشد)،
- lint و build وب اپ، و ساخت image داکر.

برای deploy خودکار از CI: یک توکن با `fly tokens create deploy` بسازید، در GitHub به‌عنوان secret `FLY_API_TOKEN` بگذارید و
مرحلهٔ `flyctl deploy --remote-only` را به workflow اضافه کنید.

## 5. اجرای محلی image

```bash
docker build -t p2ppay .
docker run --rm -p 8080:8080 -e NODE_ENV=staging -e DATABASE_URL=postgres://… -e DATA_ENCRYPTION_KEY=… p2ppay
```

در `NODE_ENV=production` سرور بدون `DATABASE_URL` یا با `SMS_PROVIDER=console` شروع نمی‌شود.

## 6. مانیتورینگ (حداقل)

- `fly logs` و داشبورد Metrics در Fly؛ هشدار Fly برای health check ناموفق.
- پنل مدیریت → «بلاک‌چین»: موجودی کیف داغ، برداشت‌های در حال ارسال/ناموفق، زمان و خطای آخرین دور.
- Supabase → Reports: اتصال‌ها، کندترین کوئری‌ها، فضای دیسک.

---

## Checklist (English)

1. Supabase project in **ap-south-1**; note the **session pooler (5432)** or direct URL — not the 6543 transaction pooler.
2. Download the database CA certificate; create a **private** Storage bucket `kyc`; copy the server secret key.
3. `fly launch --no-deploy --copy-config --region bom`, then `fly secrets set` as above (`DATABASE_URL`, `DATABASE_CA`,
   `SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY`, `DATA_ENCRYPTION_KEY`, admin, Twilio, TronGrid, mnemonic, cold wallet).
4. `fly deploy` — migrations run as the release command; `/api/health` gates the rollout.
5. `fly certs add <domain>`; keep `TRON_NETWORK=nile` until the beta is signed off.
