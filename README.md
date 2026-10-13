# FeedbackHub - Mobile-First Customer & Academic Feedback Platform

FeedbackHub is a production-ready, mobile-first customer and institutional feedback management platform. It allows businesses, colleges, and clinics to capture instant feedback via QR codes, analyze sentiment in real time, build dynamic multi-question surveys with conditional logic, and manage complaints through dedicated workflows.

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
  * `FeedbackForm`: Dynamic feedback forms with unique slugs, lifecycle states (`draft`, `published`, `paused`, `archived`), starter templates, college field toggles, and 12 question types with conditional rules.
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
# Replace with your cluster credentials
MONGODB_URI=mongodb+srv://<username>:<password>@cluster0.eyhonyw.mongodb.net/feedbackhub?retryWrites=true&w=majority

# JWT Authentication Secret (Must be >= 32 characters in production)
JWT_SECRET=super_secret_jwt_key_feedbackhub_at_least_32_characters_long_for_security_2026!

# Public Domain / Base URL (Used for QR codes and CORS validation)
PUBLIC_APP_URL=http://localhost:3000

# Demo Switcher Mode (Strictly set to false in production)
ENABLE_DEMO_MODE=true
```

> [!IMPORTANT]
> In production (`NODE_ENV=production`), the backend validates `JWT_SECRET` at startup and terminates immediately if the secret is absent, insecure, or fewer than 32 characters.
> You can generate a cryptographically strong 64-hex-character secret using:
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
MONGODB_URI=mongodb+srv://<username>:<password>@cluster0.eyhonyw.mongodb.net/feedbackhub?retryWrites=true&w=majority
```

### 3. Run Data Migration (Non-Destructive)
If upgrading from a previous local JSON database (`data/database.json`), run the automated migration script:
```bash
npm run migrate:mongo
```
* Safely backs up `data/database.json` to `data/database.backup.<timestamp>.json`.
* Imports existing businesses, users, locations, forms, and feedbacks into MongoDB Atlas without deleting the source file.

### 4. Seed Development Accounts (Dev Mode Only)
To populate starter demo accounts and template forms:
```bash
npm run seed
```
*(Blocked from executing in production environments for security.)*

### 5. Start the Application
```bash
npm start
# Server listens at http://localhost:3000
```

---

## 🔒 Security & Authorization Highlights

1. **Demo Role Escalation Lock**:
   * The `/api/auth/switch-demo` endpoint is active **only** when `ENABLE_DEMO_MODE=true` and `NODE_ENV !== 'production'`.
   * Public requests cannot obtain a `superadmin` token via demo switching; requests requesting super-admin elevation are rejected with `403 Forbidden`.
   * Super-admin access requires explicit login via credentials (`admin@feedbackhub.com` / `Admin@123`).
2. **Multi-Tenant Data Isolation**:
   * All database queries for forms, feedback, internal notes, locations, analytics, settings, and CSV exports are explicitly scoped to `req.user.businessId`.
   * Cross-tenant query tampering is blocked on the server.
3. **Sliding-Window Rate Limiting**:
   * Production zero-dependency rate limiter with sliding window IP tracking.
   * Emits standard RFC `RateLimit-Limit`, `RateLimit-Remaining`, `RateLimit-Reset`, and `Retry-After` (on HTTP 429).
4. **Health & Readiness Check**:
   * `GET /api/health` distinguishes between running process liveness (`status: healthy`) and database readiness (`ready: true/false`).
5. **No Review Gating**:
   * In compliance with consumer review guidelines, the optional Google Review prompt is displayed to all respondents if a Google Business URL is configured, regardless of star rating.
   * Low-star ratings (1-3 stars) simultaneously present reassurance of direct internal managerial follow-up without hiding public review options.
6. **Token Hygiene**:
   * JWT payloads contain only non-sensitive identifiers (`id`, `role`, `businessId`). Passwords, hashes, and PII are never encoded into tokens.

---

## 🛠️ Dynamic Form Builder & Academic Workflows

### 12 Supported Question Types
1. **Rating Control** (`rating`): Large, accessible 5-star touch controls (1–5 scale).
2. **Net Promoter Score** (`nps`): Touch-friendly 0–10 advocacy scale.
3. **Multiple Choice** (`choice`): Single-select radio chips.
4. **Dropdown Select** (`select`): Accessible dropdown selector.
5. **Checkboxes** (`checkbox`): Multi-select options.
6. **Yes / No Toggle** (`yesno`): Dual-button toggle.
7. **Short Text** (`text`): Single-line text input with character limits.
8. **Multiline Comment** (`multiline`): Responsive auto-resizing comment box.
9. **Email Address** (`email`): Validated email input.
10. **Phone Number** (`phone`): Validated telephone input.
11. **Numeric Value** (`number`): Quantitative score or metric input.
12. **Date Picker** (`date`): Standardized calendar picker with strict server-side validation.

### Real-Time Conditional Logic
Questions support dynamic visibility rules configured directly in the Form Builder:
* **Operators**: `equals`, `not_equals`, `greater_than`, `less_than`, `contains`.
* **Client & Server Evaluation**: Rules are evaluated live in the browser as the respondent fills out the form and verified on the server before database persistence.

### College & Institutional Academic Master Data
* **Academic Form Toggles**: Configure department, course/degree, academic year, semester, section/batch, faculty member, subject, and category.
* **Server-Side Validation**: Server validates that submitted faculty members and subjects strictly belong to the selected department according to `business.academicConfig`.
* **Anonymous Submissions**: Toggling "Allow Anonymous Submissions" hides mandatory student name and contact requirements.
* **Academic Master Data Management**: Manage campus directories (departments, courses, faculty directory, and course mappings) in Business Settings.

### Form Starter Templates
* 🎓 College Academic & Course Evaluation
* 👨‍🏫 Faculty & Teaching Evaluation
* 🏛️ Campus & Facilities Feedback
* 🍽️ Restaurant & Dining Experience
* 📚 Coaching & Test Prep Evaluation
* 💼 General Customer Experience

---

## 🧪 Automated Testing Architecture

### Run All Automated Suites
```bash
npm test
```
Executes all four primary automated test suites with clear PASS / FAIL summary reporting.

### Individual Test Suites
```bash
# 1. Security, RBAC & Isolation Suite (16 Tests)
npm run test:security

# 2. NPS & Rating Formula Correctness Suite (11 Tests)
npm run test:nps

# 3. Injection Hardening & Form Builder Validation Suite (7 Tests)
npm run test:injection

# 4. College Academic 12-Step End-to-End Scenario Suite (17 Tests)
npm run test:college

# 5. Native Edge CDP Responsive Multi-Device Verification (320px - 1440px)
npm run test:responsive
```

### Verified Acceptance Criteria:
* **NPS Accuracy**: NPS formula strictly computed from 0–10 NPS answers (`Promoters (9-10) - Detractors (0-6)`). Star ratings (1-5) and NPS are completely segregated. Forms without rating or NPS return explicit `N/A` without fabricated 5 stars or NaN crashes.
* **Injection Hardening**: Question IDs with XSS or directory traversal are sanitized. Blank question labels and option-less choices are rejected with HTTP 400. Self-referential conditional loops and dependencies on non-existent questions are blocked.
* **College Field Validation**: Department, faculty, subject, and academic years are strictly validated against institutional master data. Cross-departmental faculty mismatches are rejected with HTTP 400.
* **Form Lifecycle**: New forms default to `draft`. Draft and paused forms strictly reject public submissions with HTTP 403. Form QR pages indicate draft/paused status.
* **Tenant Isolation**: Forms, locations, feedback, and analytics are isolated per tenant. Cross-business view or modification attempts are blocked with HTTP 403.
* **Test Isolation**: Automated test suites run in isolated test database mode so offline environments or disconnected Atlas clusters do not yield false 503s. Negative tests prove genuine HTTP 400 and 403 status codes.

---

## 📄 License
MIT License. Created for College Mini Project & Enterprise Feedback Management.
