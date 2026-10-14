# FeedbackHub - Mobile-First Customer & Academic Feedback Platform

FeedbackHub is a mobile-first customer and institutional feedback management platform (Release Candidate; ready for production deployment upon completion of live release verification). It enables businesses, colleges, and clinics to capture instant feedback via QR codes, analyze sentiment and NPS in real time, build dynamic multi-question surveys with acyclic conditional dependency logic, and manage complaints through dedicated workflows.

---

## 🌟 Architecture & Technology Stack

* **Runtime**: **Node.js 22 LTS** (minimum engine requirement: `>=20.19.0` for Mongoose 9 compatibility).
* **Frontend**: Vanilla JavaScript (ES6+), Semantic HTML5, CSS Grid & Flexbox design system.
  * Mobile-first responsive layout verified across **320px to 1440px+** viewports.
  * Zero external JavaScript framework dependencies.
  * Zero-dependency offline SVG QR code generator (`/js/qr.js`).
* **Backend**: Node.js & Express REST API.
  * Strict security headers (`nosniff`, `SAMEORIGIN`, `XSS-Protection`, `HSTS`).
  * In-memory sliding-window request rate limiting for authentication and public submissions.
  * Graceful shutdown handlers for `SIGINT` and `SIGTERM`.
* **Database**: MongoDB Atlas with persistent Mongoose models:
  * `User`: Multi-tenant user accounts with role-based access (`owner`, `manager`, `college_admin`, `staff`, `superadmin`). Normalized unique email index.
  * `Business`: Profile, business type (`college`, `coaching`, `restaurant`, `healthcare`, `salon`, `other`), structured physical address or online-only mode, and academic master data (`academicConfig`).
  * `Location`: Multi-store / branch locations with tenant scoping.
  * `FeedbackForm`: Dynamic feedback forms with unique slugs, lifecycle states (`draft`, `published`, `paused`, `archived`), starter templates, college field toggles, and 13 question types (rating, nps, sentiment, text, multiline, choice, select, checkbox, yesno, email, phone, number, date) with full acyclic dependency graph validation.
  * `Feedback`: Customer submissions with server-authoritative sentiment classification, priority routing, academic details, internal notes, and resolution tracking. Arbitrary client-spoofed sentiments are ignored.
  * `AuditLog`: System and super-admin audit trail.

---

## ⚙️ Environment Variables Configuration

Create a `.env` file inside `backend/` (or copy from `backend/.env.example`):

```bash
# Server Port & Environment
PORT=3000
NODE_ENV=development

# Database Connection (MongoDB Atlas Connection String)
# Replace with your actual cluster credentials
MONGODB_URI=mongodb+srv://<username>:<password>@cluster0.mongodb.net/feedbackhub?retryWrites=true&w=majority

# Optional: Dedicated Disposable Database for Live Integration & Smoke Tests
# TEST_MONGODB_URI=mongodb+srv://<username>:<password>@cluster0.mongodb.net/feedbackhub_test?retryWrites=true&w=majority

# JWT Authentication Secret (Must be >= 32 characters in production)
# Generate a cryptographically secure random string with:
# node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"
JWT_SECRET=GENERATE_SECURE_SECRET_WITH_CRYPTO_RANDOMBYTES_32

# Public Domain / Base URL (Used for QR codes and CORS validation)
PUBLIC_APP_URL=http://localhost:3000

# Demo Switcher Mode (Strictly set to false in production)
ENABLE_DEMO_MODE=false

# DNS Resolver (Default is false: uses OS DNS. Set to true in dev only if router blocks SRV)
# Strictly prohibited in production (NODE_ENV=production always enforces OS system DNS)
ENABLE_FALLBACK_DNS=false
```

> [!IMPORTANT]
> In production (`NODE_ENV=production`), the backend validates `JWT_SECRET` at startup and terminates immediately if the secret is absent, matches known example strings/placeholders, or is fewer than 32 characters.
> Generate a cryptographically strong 64-hex-character secret using:
> ```bash
> node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"
> ```

---

## 🚀 Quick Start Guide

### 1. Prerequisites & Node Version
* **Node.js**: `22.x` (LTS recommended, minimum `>=20.19.0`)
* **npm**: `10.x` or `11.x`
* Verify installed versions:
  ```bash
  node -v
  npm -v
  ```

### 2. Clean Installation via Lockfile
To install exact pinned dependencies cleanly:
```bash
npm ci
```

### 3. Configure MongoDB Atlas
Update `backend/.env` with your active MongoDB Atlas connection URI:
```env
MONGODB_URI=mongodb+srv://<username>:<password>@cluster0.mongodb.net/feedbackhub?retryWrites=true&w=majority
```

### 4. Bootstrap Production Super-Admin (Secure CLI)
To provision an initial super-administrator without using hardcoded demo passwords:
```bash
npm run bootstrap:superadmin -- admin@yourdomain.com StrongPassword@2026 "Site Admin"
```

### 5. Seed Starter Data (Safe & Non-Destructive by Default)
Populate starter demo accounts and template forms in development:
```bash
npm run seed
```
* **Production Refusal Guard**: Refuses execution before connecting whenever `NODE_ENV=production` or `NODE_ENV` is unspecified. Demo accounts are never seeded in production.
* **Zero Demo Super-Admin Accounts**: The seed script strictly creates demo owner, college admin, manager, and staff accounts only; it never creates super-admin accounts. Production administrative accounts must be created using the secure bootstrap CLI (`npm run bootstrap:superadmin`).
* **Non-Destructive by Default**: Uses deterministic upserts. Existing businesses, users, user passwords, custom forms, and feedback are strictly preserved.
* **Destructive Reset Guard**: Destructive seeding requires `ALLOW_DESTRUCTIVE_SEED=true` **AND** a database name verified to contain development/test keywords (`test`, `dev`, `local`). Destructive operations against unrecognized or production databases are refused.
* **Explicit Precedence**: Uses `MONGODB_URI` from the environment or an explicitly passed URI; it never silently falls back to `TEST_MONGODB_URI`.

### 6. Start the Application
```bash
npm start
# Server binds to 0.0.0.0 and listens at http://localhost:3000
```

---

## 🔒 Security & Data Safety Architecture

1. **Deterministic Non-Destructive Seeding**:
   * Seeding does not execute blind `deleteMany({})`. It verifies whether records already exist and updates metadata without overwriting passwords or unrelated tenant data.
   * Target database name and operation mode are printed to the console before any database modification.
2. **JWT Secret Validator & Blacklist**:
   * Startup rejects short keys (< 32 chars in production) and blacklisted default strings (`feedbackhub-super-secret-key-2026`, `replace-with-a-very-secure-random...`, etc.).
3. **Multi-Tenant Data Isolation**:
   * All database queries for forms, feedback, internal notes, locations, analytics, settings, and CSV exports are explicitly scoped to `req.user.businessId`.
   * Cross-tenant viewing or tampering attempts return `403 Forbidden`.
4. **Rate Limiting & Security Headers**:
   * Zero-dependency sliding window rate limiter protects auth and feedback submission endpoints, returning RFC standard `RateLimit-*` and `Retry-After` headers.
   * Emits `nosniff`, `SAMEORIGIN`, `X-XSS-Protection`, and `Strict-Transport-Security`.
5. **No Review Gating**:
   * Google Review prompts are presented unconditionally across all rating scores (1★ to 5★) in compliance with consumer review transparency guidelines.

---

### Role-Based Access Control (RBAC) Permission Matrix (Phase 5)

| Resource / Action | Owner | College Admin | Manager | Staff | Superadmin |
| :--- | :---: | :---: | :---: | :---: | :---: |
| **Create Form** (`POST /api/forms`) | ✅ | ✅ | ❌ | ❌ | ✅ |
| **Edit Form** (`PUT /api/forms/:id`) | ✅ | ✅ | ❌ | ❌ | ✅ |
| **Publish / Pause / Archive Form** | ✅ | ✅ | ❌ | ❌ | ✅ |
| **Delete Form** (`DELETE /api/forms/:id`) | ✅ | ✅ | ❌ | ❌ | ✅ |
| **Edit Business Settings** (`PUT /api/auth/business-settings`) | ✅ | ✅ | ❌ | ❌ | ✅ |
| **Create & Edit Locations** (`POST/PUT /api/locations`) | ✅ | ✅ | ✅ | ❌ | ✅ |
| **Delete Location** (`DELETE /api/locations/:id`) | ✅ | ✅ | ❌ | ❌ | ✅ |
| **Resolve Complaints** (`POST /api/feedback/:id/resolve`) | ✅ | ✅ | ✅ | ❌ | ✅ |
| **Change Feedback Status / Priority** | ✅ | ✅ | ✅ | ❌ | ✅ |
| **Export Feedback CSV** (`GET /api/feedback/export/csv`) | ✅ | ✅ | ✅ | ❌ | ✅ |
| **Add Internal Notes** (`POST /api/feedback/:id/notes`) | ✅ | ✅ | ✅ | ✅ | ✅ |
| **View Feedback Inbox** (`GET /api/feedback`) | ✅ | ✅ | ✅ | ✅ | ✅ |

---

## 🛠️ Dynamic Form Builder & Publishing Lifecycle

### 12 Supported Question Types & Strict Validation Boundaries
1. **Rating Control** (`rating`): Strict integer bounds where $1 \le \min < \max \le 5$. Malicious payloads rendering arbitrary numbers of stars or non-integer steps are rejected.
2. **Net Promoter Score** (`nps`): Standard 0–10 advocacy scale ($\min: 0$, $\max: 10$).
3. **Multiple Choice** (`choice`): Single-select choices capped at 50 options, max 200 characters per option string.
4. **Dropdown Select** (`select`): Accessible dropdown selector with max 50 options, max 200 characters per option.
5. **Checkboxes** (`checkbox`): Multi-select options with max 50 options.
6. **Yes / No Toggle** (`yesno`): Strict boolean toggle with verified Yes/No persistence.
7. **Short Text** (`text`): Single-line text input (up to 500 characters).
8. **Multiline Comment** (`multiline`): Responsive auto-resizing comment box (up to 3000 characters).
9. **Email Address** (`email`): Validated RFC email format.
10. **Phone Number** (`phone`): Validated telephone input.
11. **Numeric Value** (`number`): Strict `Number.isFinite` validation.
12. **Date Picker** (`date`): Strict calendar date validation (rejecting non-calendar dates such as February 31).

### Unbypassable Form Publishing Lifecycle
* **Draft by Default**: `POST /api/forms` unconditionally initializes forms in `draft` status regardless of the client payload.
* **General Update Guard**: `PUT /api/forms/:id` strictly rejects `status` changes with `HTTP 400`, preventing lifecycle bypass.
* **Enforced State Machine Transitions**:
  * `draft` $\to$ `published`, `archived`
  * `published` $\to$ `paused`, `archived`
  * `paused` $\to$ `published`, `archived`
  * `archived` $\to$ `draft`
  * Illegal transitions (e.g. attempting to pause a `draft` form) return `HTTP 400`.
* **Pre-Publication Definition Verification**:
  Before transitioning to `published`, the backend validates the complete form definition:
  1. Title cannot be empty.
  2. Question list must contain at least 1 question.
  3. Stable unique question IDs matching `/^[a-zA-Z0-9_-]{1,64}$/`.
  4. Bounds validation ($1 \le \text{rating} \le 5$, $0 \le \text{NPS} \le 10$).
  5. Option list bounds ($\le 50$ options, $\le 200$ chars).
  6. Acyclic conditional dependency verification via Depth-First Search (DFS).
  Publishing incomplete or malformed forms returns `HTTP 400`.

### Dependency Graph Cycle Detection
* **Acyclic Validation**: Form creation, editing, and publishing validate the question dependency graph using Depth-First Search (DFS) with 3-color cycle detection.
* Detects self-references ($A \to A$), 2-node cycles ($A \to B \to A$), and transitive loops ($A \to B \to C \to A$).
* **Strict Operators**: Rejects invalid operators without silent fallbacks (`equals`, `not_equals`, `in`, `greater_than`, `less_than`, `contains`).
* Requires valid finite numbers for `greater_than` and `less_than` comparisons.

### Institutional Academic Master Data
* **No Hardcoded Fallbacks**: Dropdown choices for academic years, semesters, sections, faculty, and subjects are dynamically derived from the institution's `academicConfig`.
* **Clean Values & Dropdown Resetting**: Dropdowns store clean subject identifiers as option values while displaying `Subject Name (Code)`. Changing department resets any invalid or stale selections.
* **Cross-Department Protection**: Server rejects forged subjects or faculty members that do not match the chosen department.

---

## 📊 Analytics & Complaints Correctness

* **Complaints Helper (`isComplaint`)**:
  * A submission is identified as a complaint if star rating $\le 2$, OR NPS $\le 6$ (detractor), OR sentiment is negative.
  * A high star rating (e.g. 4 or 5 stars) **never overrides** a low NPS detractor score or negative sentiment.
* **Segregated Star Rating & NPS Metrics**:
  * Star rating is averaged strictly from submissions containing a 1–5 star rating question. Submissions without rating questions are excluded and return `'N/A'`.
  * NPS is computed using standard advocacy rules: $\text{NPS} = \% \text{Promoters (9-10)} - \% \text{Detractors (0-6)}$. Submissions without an NPS answer are excluded from the denominator.

---

## 🎓 College Onboarding & Form Publication Workflow

FeedbackHub provides a verified onboarding workflow tailored for academic institutions:
1. **Initial Draft Protection**: When a new college registers, their initial course evaluation form is provisioned in `draft` status (unlike non-college businesses which receive a published starter form). This prevents exposing unfillable public forms when faculty and course units are not yet defined.
2. **Setup Guidance Banner**: The college dashboard surfaces an onboarding banner directing administrators through:
   * **Step 1**: Add institution departments, courses, faculty members, and subjects in **Business Settings** (`#/settings`).
   * **Step 2**: Preview and publish the starter evaluation form in **Form Builder** (`#/builder`).
   * **Step 3**: Download or print high-resolution QR codes in **QR Codes** (`#/qr`).
3. **Publication Safety Guard**: The backend strictly guards form publication (`PUT /api/forms/:id/publish`). It blocks transition to `published` with HTTP 400 if:
   * Any choice, select, or checkbox question has zero selectable options.
   * Any enabled & required college academic field (e.g. Faculty, Subject, Department) has zero configured options in Business Settings.

---

## ⭐ Overall Rating Configuration & Metric Integrity

* **Form-Level Controls**:
  * Form builders can configure `showOverallRating` and `requireOverallRating` checkboxes in Form Builder settings.
  * When `showOverallRating: false`, the public form hides the 5-star rating widget, does not require an overall rating, and keeps `feedback.rating = null`.
* **Segregated Question Ratings & Clean Averages**:
  * Individual rating questions in `answers` (e.g., teaching clarity, infrastructure) are preserved without being copied or stolen into `feedback.rating`.
  * `calculateAverageRating` calculates the arithmetic mean strictly across submissions that contain an overall rating, excluding `null` unrated submissions from the denominator.
* **Route Ordering & Clean 404 Responses**:
  * Unknown `/api/*` endpoints return structured JSON HTTP 404 (`{ "error": "API endpoint ... not found" }`), never HTML.
  * Missing static assets (`.js`, `.css`, images) return HTTP 404 text, preventing SPA fallback masking.
  * Public form URLs `/feedback/:slug` serve `feedback.html`.
  * Dashboard client routes serve `index.html`.

---

## 🧪 Automated Testing Architecture

### Diagnostics Command
Before starting the server or running integration tests, run the built-in system diagnostics:
```bash
npm run diagnose
```
Reports environment file detection, port availability, active instance health detection, masked MongoDB Atlas connection test, and static asset integrity.

### Automated Testing & Release Verification Architecture

FeedbackHub provides two distinct tiers of automated verification:

1. **`npm test` (Master Verification Runner - 15 Suites)**:
   * Executes 13 offline unit, safety, security, and Express API integration suites against isolated in-memory mock storage (no live database required).
   * Executes 2 live MongoDB Atlas integration suites (16-Step API Integration & 13-Step Release Smoke Verification) when `TEST_MONGODB_URI` is configured in `backend/.env`.
   * If `TEST_MONGODB_URI` is not configured, live database suites report `[STATUS: SKIPPED]` cleanly with setup instructions, allowing offline checks to pass without requiring cloud database credentials.

2. **`npm run verify:release` (Strict Release Gating - 15 Suites)**:
   * Strict pre-deployment release gate for CI/CD pipelines and deployment signoff.
   * **Mandatory Requirement**: `TEST_MONGODB_URI` **must** be set, pointing to a verified disposable database (name containing `test`, `dev`, or `temp`).
   * Unlike `npm test`, `verify:release` **strictly refuses to pass** if any live database test is skipped or fails. It terminates immediately with exit code 1 if `TEST_MONGODB_URI` is absent, contains placeholders, or points to a non-disposable database. All 15 suites must pass with exit code 0.

#### Run the Verification Runner
```bash
npm test
```

#### Run Strict Release Gating
```bash
npm run verify:release
```
> [!IMPORTANT]
> `npm run verify:release` requires `TEST_MONGODB_URI` pointing to a disposable test database (e.g. `mongodb+srv://.../feedbackhub_test`). If `TEST_MONGODB_URI` is missing or any live test is skipped, `verify:release` fails with exit code 1.

### Individual Test Suites
```bash
# Master Test Runner (All Active Suites)
npm test

# Strict Release Gating (Fails if TEST_MONGODB_URI is missing or live tests are skipped)
npm run verify:release

# Phase 15 Secure Sentiment Classification & Release Verification
npm run test:phase15

# Phase 14 Regression & Workflow Verification (Submissions / Sentiment / College Onboarding)
npm run test:phase14

# Phase 13 Logic Verification (Conditionals / NPS Authority / Complaints)
npm run test:phase13

# Phase 10 Release Readiness & Usability
npm run test:phase10

# Phase 8 Production Safety, Mock DB Prohibition & E2E Registration
npm run test:phase8

# Phase 7 Signup, Routing Resilience & Blank-Screen Prevention
npm run test:phase7

# Phase 5 RBAC, Lifecycle Transitions & Production Safety
npm run test:phase5

# Security, Auth & RBAC Isolation
npm run test:security

# Real MongoDB Atlas Live Integration (Requires TEST_MONGODB_URI)
npm run test:integration

# Final 13-Step Release Smoke Verification (Requires TEST_MONGODB_URI)
npm run test:smoke

# Multi-Device Responsive UI Verification (320px - 1440px)
npm run test:responsive
```

---

## 🚫 Mock Database Prohibition in Production

* **Strict Refusal**: `TEST_MOCK_DB=true` is strictly prohibited when `NODE_ENV=production`. If activated, the backend fails startup immediately with a fatal security configuration error.
* **Health Check Honesty**: In production, `/api/health` reports `status: degraded`, `ready: false`, and HTTP 503 if persistent MongoDB is disconnected or if in-memory mock storage is active. It only reports `ready: true` when genuine MongoDB Atlas persistence is active (`readyState === 1`).
* **Zero Silent Fallback**: The database layer never silently falls back to in-memory mock data or JSON files if MongoDB becomes unreachable. It throws an explicit HTTP 503 error with an informative status message.

---

## 🚀 Deployment Guide (Render)

FeedbackHub is architected to deploy seamlessly as a single unified **Render Web Service** that serves both the Express backend API and the responsive vanilla frontend on the same origin.

### 1. Blueprint Deployment (`render.yaml`)
A verified [render.yaml](./render.yaml) blueprint is included in the project root:
1. Push your repository to GitHub.
2. In the [Render Dashboard](https://dashboard.render.com), click **New +** > **Blueprint**.
3. Select your repository. Render will automatically configure the service using `render.yaml`.

### 2. Manual Service Configuration
Alternatively, create a new **Web Service** manually in Render:
* **Environment**: `Node`
* **Node Version**: `22` (declare `NODE_VERSION=22` in environment variables)
* **Build Command**: `npm ci`
* **Start Command**: `npm start`
* **Health Check Path**: `/api/health`
* **Auto-Deploy**: `Yes`

### 3. Required Production Environment Variables
Configure the following environment variables in your Render service settings:

| Variable | Required | Description | Example / Recommended Setting |
| :--- | :---: | :--- | :--- |
| `NODE_ENV` | **Yes** | Enforces production security guards | `production` |
| `NODE_VERSION` | **Yes** | Specifies Node.js runtime version | `22` |
| `PORT` | **Yes** | Assigned automatically by Render | `10000` (Render default) |
| `MONGODB_URI` | **Yes** | Production MongoDB Atlas connection URI | `mongodb+srv://<user>:<password>@cluster.mongodb.net/feedbackhub?retryWrites=true&w=majority` |
| `JWT_SECRET` | **Yes** | Cryptographically random secret ($\ge 32$ chars) | Render generates automatically, or use: `node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"` |
| `PUBLIC_APP_URL` | **Yes** | Deployed canonical HTTPS origin | `https://feedbackhub.onrender.com` |
| `ALLOWED_ORIGINS` | Optional | Permitted CORS origins (matches public URL) | `https://feedbackhub.onrender.com` |
| `ENABLE_DEMO_MODE` | **Yes** | Strictly disables 1-click demo role switcher | `false` |
| `ENABLE_FALLBACK_DNS` | No | Dev-only fallback DNS flag; strictly prohibited & ignored in production | `false` |

> [!WARNING]
> * Never run `npm run seed` in production. Seeding is strictly blocked when `NODE_ENV=production`.
> * Provision your initial super-admin using the CLI:
>   ```bash
>   npm run bootstrap:superadmin -- admin@yourdomain.com StrongAdminPass@2026 "Site Admin"
>   ```
> * The server binds to `0.0.0.0` on Render's assigned `PORT` and verifies port availability before attempting database connections to eliminate `EADDRINUSE` collision masking.
> * Public QR codes dynamically resolve using `PUBLIC_APP_URL`, preventing accidental localhost links in production.

---

## 📌 Known Limitations & Troubleshooting

1. **DNS SRV Resolution on Local Windows Networks**: By default, the application preserves the operating system's default DNS resolver. If local residential ISP routers fail DNS SRV lookups for `mongodb+srv://` (emitting `querySrv ECONNREFUSED`) during development, set `ENABLE_FALLBACK_DNS=true` in `backend/.env` to opt into Google/Cloudflare public fallback DNS (`8.8.8.8`, `1.1.1.1`). In production (`NODE_ENV=production`), fallback DNS is strictly prohibited and standard system DNS is always enforced.
2. **Disposable Test Database Requirement**: Live MongoDB Atlas tests (`npm run test:integration`, `npm run test:smoke`) require a disposable database configured via `TEST_MONGODB_URI` to prevent accidental data modification on production clusters.
3. **Super-Admin CLI Provisioning**: In production, super-admin accounts cannot be seeded via `npm run seed`. Administrators must run `npm run bootstrap:superadmin`.

---

## 📄 License
MIT License. Created for College Mini Project & Enterprise Feedback Management.
