# FeedbackHub - Mobile-First Customer & Academic Feedback Platform

FeedbackHub is a production-ready, mobile-first customer and institutional feedback management platform. It enables businesses, colleges, and clinics to capture instant feedback via QR codes, analyze sentiment and NPS in real time, build dynamic multi-question surveys with acyclic conditional dependency logic, and manage complaints through dedicated workflows.

---

## 🌟 Architecture & Technology Stack

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
  * `FeedbackForm`: Dynamic feedback forms with unique slugs, lifecycle states (`draft`, `published`, `paused`, `archived`), starter templates, college field toggles, and 12 question types with full acyclic dependency graph validation.
  * `Feedback`: Customer submissions with sentiment classification, priority routing, academic details, internal notes, and resolution tracking.
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

# Optional: Dedicated Disposable Database for Live Integration Tests
# TEST_MONGODB_URI=mongodb+srv://<username>:<password>@cluster0.mongodb.net/feedbackhub_test?retryWrites=true&w=majority

# JWT Authentication Secret (Must be >= 32 characters in production)
# Generate a cryptographically secure random string with:
# node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"
JWT_SECRET=GENERATE_SECURE_SECRET_WITH_CRYPTO_RANDOMBYTES_32

# Public Domain / Base URL (Used for QR codes and CORS validation)
PUBLIC_APP_URL=http://localhost:3000

# Demo Switcher Mode (Strictly set to false in production)
ENABLE_DEMO_MODE=false
```

> [!IMPORTANT]
> In production (`NODE_ENV=production`), the backend validates `JWT_SECRET` at startup and terminates immediately if the secret is absent, matches known example strings/placeholders, or is fewer than 32 characters.
> Generate a cryptographically strong 64-hex-character secret using:
> ```bash
> node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"
> ```

---

## 🚀 Quick Start Guide

### 1. Install Dependencies
```bash
npm install
```

### 2. Configure MongoDB Atlas
Update `backend/.env` with your active MongoDB Atlas connection URI:
```env
MONGODB_URI=mongodb+srv://<username>:<password>@cluster0.mongodb.net/feedbackhub?retryWrites=true&w=majority
```

### 3. Bootstrap Production Super-Admin (Secure CLI)
To provision an initial super-administrator in production without using hardcoded demo passwords:
```bash
npm run bootstrap:superadmin -- admin@yourdomain.com StrongPassword@2026 "Site Admin"
```

### 4. Seed Starter Data (Safe & Non-Destructive by Default)
Populate starter demo accounts and template forms in development:
```bash
npm run seed
```
* **Production Refusal Guard**: Refuses execution before connecting whenever `NODE_ENV=production` or `NODE_ENV` is unspecified. Demo accounts are never seeded in production.
* **Zero Demo Super-Admin Accounts**: The seed script strictly creates demo owner, college admin, manager, and staff accounts only; it never creates super-admin accounts. Production administrative accounts must be created using the secure bootstrap CLI (`npm run bootstrap:superadmin`).
* **Non-Destructive by Default**: Uses deterministic upserts. Existing businesses, users, user passwords, custom forms, and feedback are strictly preserved.
* **Destructive Reset Guard**: Destructive seeding requires `ALLOW_DESTRUCTIVE_SEED=true` **AND** a database name verified to contain development/test keywords (`test`, `dev`, `local`). Destructive operations against unrecognized or production databases are refused.
* **Explicit Precedence**: Uses `MONGODB_URI` from the environment or an explicitly passed URI; it never silently falls back to `TEST_MONGODB_URI`.

### 5. Start the Application
```bash
npm start
# Server listens at http://localhost:3000
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

## 🧪 Automated Testing Architecture

### Run All Automated Suites
```bash
npm test
```
Executes all automated suites with full summary reporting:
```
======================================================
              AUTOMATED VERIFICATION SUMMARY          
======================================================
1. Security & Auth Isolation [Isolated Mock DB]: PASS ✓
2. NPS & Rating Formula Correctness [Isolated Mock DB]: PASS ✓
3. Injection Hardening & Validation [Isolated Mock DB]: PASS ✓
4. College Academic 12-Step E2E Flow [Isolated Mock DB]: PASS ✓
5. Phase 4 Unit Tests (Graph/Analytics/JWT) [Pure Unit Tests]: PASS ✓
6. Phase 4 Data Safety & DB Protection [Safety Unit Tests]: PASS ✓
7. Phase 5 RBAC, Lifecycle & Safety [Isolated Mock DB]: PASS ✓
8. Real MongoDB Atlas Integration [Live Database]: SKIPPED (no TEST_MONGODB_URI configured)
======================================================
```

### Individual Test Suites
```bash
# 1. Master Suite (All 8 Suites)
npm test

# 2. Phase 5 RBAC, Lifecycle & Production Safety
npm run test:phase5

# 3. Security, RBAC & Multi-Tenant Isolation
npm run test:security

# 4. Multi-Device Responsive UI Verification (320px - 1440px)
npm run test:responsive
```

---

## 📄 License
MIT License. Created for College Mini Project & Enterprise Feedback Management.
