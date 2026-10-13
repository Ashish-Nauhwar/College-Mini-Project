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
Populate starter demo accounts and template forms:
```bash
npm run seed
```
* **Non-Destructive by Default**: Uses deterministic upserts. Existing businesses, users, user passwords, custom forms, and feedback are strictly preserved.
* **Destructive Reset Guard**: Destructive seeding requires `ALLOW_DESTRUCTIVE_SEED=true` **AND** a database name verified to contain development/test keywords (`test`, `dev`, `local`). Destructive operations against unrecognized or production databases are refused.

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

## 🛠️ Dynamic Form Builder & Academic Workflows

### 12 Supported Question Types
1. **Rating Control** (`rating`): Large, accessible 5-star touch controls (1–5 scale).
2. **Net Promoter Score** (`nps`): Standard 0–10 advocacy scale.
3. **Multiple Choice** (`choice`): Single-select choices with required options.
4. **Dropdown Select** (`select`): Accessible dropdown selector.
5. **Checkboxes** (`checkbox`): Multi-select options.
6. **Yes / No Toggle** (`yesno`): Strict boolean toggle with verified Yes/No persistence.
7. **Short Text** (`text`): Single-line text input (up to 500 characters).
8. **Multiline Comment** (`multiline`): Responsive auto-resizing comment box (up to 3000 characters).
9. **Email Address** (`email`): Validated RFC email format.
10. **Phone Number** (`phone`): Validated telephone input.
11. **Numeric Value** (`number`): Strict `Number.isFinite` validation.
12. **Date Picker** (`date`): Strict calendar date validation (rejecting non-calendar dates such as February 31).

### Dependency Graph Cycle Detection
* **Acyclic Validation**: Form creation and updates validate the question dependency graph using Depth-First Search (DFS) with 3-color cycle detection.
* Detects self-references ($A \to A$), 2-node cycles ($A \to B \to A$), and transitive loops ($A \to B \to C \to A$) before saving.
* **Strict Operators**: Rejects invalid operators without silent fallbacks (`equals`, `not_equals`, `in`, `greater_than`, `less_than`, `contains`).
* Requires valid finite numbers for `greater_than` and `less_than` comparisons.

### Form Lifecycle & State Transitions
* Forms default to `draft` upon creation.
* Public feedback submissions are blocked on non-published forms (`403 Forbidden`).
* Dedicated lifecycle transition endpoints:
  * `PUT /api/forms/:id/publish`
  * `PUT /api/forms/:id/pause`
  * `PUT /api/forms/:id/resume`
  * `PUT /api/forms/:id/archive`

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
1. Security, RBAC & Isolation                : PASS ✓
2. NPS & Rating Formula Correctness          : PASS ✓
3. Injection Hardening & Validation          : PASS ✓
4. College Academic 12-Step E2E Flow         : PASS ✓
5. Phase 4 Unit Tests (Graph/Analytics/JWT)  : PASS ✓
6. Phase 4 Data Safety & DB Protection       : PASS ✓
7. Real MongoDB Atlas Integration            : SKIPPED (no TEST_MONGODB_URI configured)
======================================================
```

### Individual Test Suites
```bash
# 1. Security, RBAC & Multi-Tenant Isolation (Ephemeral Server port 0)
npm run test:security

# 2. NPS & Star Rating Formula Correctness (Imports real production helpers)
npm run test:nps

# 3. Injection Hardening & Input Sanitization
npm run test:injection

# 4. College Academic 12-Step Scenario Flow
npm run test:college

# 5. Phase 4 Unit Tests (Graph Cycle Detection, Complaints Helper, JWT Validator)
npm run test:unit

# 6. Phase 4 Data Safety & Database Protection (Non-destructive seeding enforcement)
npm run test:safety

# 7. Real MongoDB Atlas Integration (Runs when TEST_MONGODB_URI is provided)
npm run test:integration

# 8. Multi-Device Responsive UI Verification (320px - 1440px)
npm run test:responsive
```

---

## 📄 License
MIT License. Created for College Mini Project & Enterprise Feedback Management.
