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
> In production (`NODE_ENV=production`), the backend validates `JWT_SECRET` at startup and will terminate immediately if the secret is absent, insecure, or fewer than 32 characters.

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
3. **No Review Gating**:
   * In compliance with consumer review guidelines, the optional Google Review prompt is displayed to all respondents if a Google Business URL is configured, regardless of star rating.
   * Low-star ratings (1-3 stars) simultaneously present reassurance of direct internal managerial follow-up without hiding public review options.
4. **Token Hygiene**:
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
12. **Date Picker** (`date`): Standardized calendar picker.

### Real-Time Conditional Logic
Questions support dynamic visibility rules configured directly in the Form Builder:
* **Operators**: `equals`, `not_equals`, `greater_than`, `less_than`, `contains`.
* **Client & Server Evaluation**: Rules are evaluated live in the browser as the respondent fills out the form and verified on the server before database persistence.

### College & Institutional Academic Master Data
* **Academic Form Toggles**: Configure department, course/degree, academic year, semester, section/batch, faculty member, subject, and category.
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

## 🧪 Automated Testing

### Run All Automated Tests
```bash
npm test
```

### Security & RBAC Suite
```bash
npm run test:security
```
Tests verified:
* Health check and live measured uptime (`process.uptime()`).
* Demo switch security (super-admin escalation rejection).
* JWT token hygiene and signature verification.
* RBAC access control on `/api/admin/overview`.
* Multi-tenant data isolation negative tests.
* Server-side conditional logic evaluation across all operators.
* Anti-review gating compliance across 1★ to 5★ ratings.
* Mongoose schema constraints for all 6 business types, structured addresses, and 12 question types.

### Native Edge CDP Responsive Verification
```bash
npm run test:responsive
```
Runs an automated browser verification using Microsoft Edge via the Chrome DevTools Protocol:
* Viewports tested: `320px`, `360px`, `375px`, `390px`, `430px`, `768px`, `1024px`, and `1440px`.
* Verifies zero horizontal scrolling (`scrollWidth <= clientWidth`) across all 12 application pages.
* Verifies 0 browser console errors during all page visits and interactions.

---

## 📄 License
MIT License. Created for College Mini Project & Enterprise Feedback Management.
