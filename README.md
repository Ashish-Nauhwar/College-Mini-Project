# FeedbackHub - Mobile-First Customer Experience & Feedback Management

FeedbackHub is a modern, mobile-first responsive customer feedback and experience management platform designed to deliver a smooth user experience across mobile phones (320px+), tablets, laptops, and desktop computers.

---

## 🌟 Key Features & Mobile Responsiveness Highlights

### 1. Mobile-First Responsive Design (320px to 1440px+)
* **Zero Horizontal Scroll**: Strictly verified across 320px, 360px, 375px, 390px, 430px, 768px, 1024px, and 1440px viewports.
* **Semantic HTML5 & Viewport**: Viewport meta tag on all pages (`width=device-width, initial-scale=1.0, maximum-scale=5.0`), accessible inputs (`type="email"`, `type="tel"`).
* **Touch-Friendly Controls**: Interactive elements meet or exceed 44 × 44 CSS pixels with generous spacing to avoid accidental taps.

### 2. Responsive Navigation
* **Desktop**: Permanent sidebar on screens 1024px and wider.
* **Mobile & Tablets**: Collapses into a touch-friendly hamburger button with a slide-out drawer, backdrop overlay, and auto-close upon navigation.

### 3. Business Dashboard
* **Adaptive Grid**: Metric cards stack into 1 column on mobile (<480px), 2 columns on tablets, and 4 columns on desktop.
* **Responsive Charts**: Hardware-accelerated Chart.js charts dynamically resize with `maintainAspectRatio: false` without overflowing.
* **Filter Stack**: Location and time range selectors stack cleanly on mobile.

### 4. Public Customer Feedback Form (`/feedback/:slug`)
* Built specifically for customers scanning QR codes on mobile phones.
* **Star Rating**: Large, easy-to-tap 48px star controls with gold highlights and descriptive accessibility tags.
* **NPS Selector**: Touch-friendly 0–10 button scale.
* **Dynamic Questions**: Choice chips, yes/no toggles, and open comments.
* **Review Redirection**: Delighted customers (4-5 stars) receive an instant prompt to post their review to Google Business. Unhappy customers (1-3 stars) receive an immediate reassurance of managerial follow-up.

### 5. Responsive Form Builder
* Accessible reordering with **Move Up (▲)** and **Move Down (▼)** buttons (no desktop drag-and-drop restriction).
* Stacked field configuration, real-time live preview modal, and instant QR code access.

### 6. Responsive Feedback Management & Inbox
* Automatic dual layout: Wide tabular layout on desktop (>=900px) and clean, data-rich card layout on mobile (<900px).
* Quick filters for rating stars, resolution status, and priority flags.
* Full-featured Detail Modal with internal team notes thread and complaint resolution workflows.

### 7. Instant QR Code Experience
* Generates crisp, square QR codes matching the actual live URL (`/feedback/:slug`).
* 1-Click "Copy Public Link", "Download High-Res PNG", and "Open Live Form".

---

## 📁 Project Directory Structure

The project is cleanly divided into separate `frontend/` and `backend/` directories:

```
Feedback Project/
├── frontend/                     # Client-side presentation & UI assets
│   ├── css/
│   │   └── style.css             # Mobile-first responsive CSS design system
│   ├── js/
│   │   ├── app.js                # Single Page App logic (dashboard, charts, inbox, builder)
│   │   └── feedback.js           # Public customer feedback form controller & QR client
│   ├── index.html                # Main application portal (Dashboard, Builder, Inbox, Analytics)
│   ├── feedback.html             # Public customer feedback submission page
│   └── package.json              # Frontend package configuration
│
├── backend/                      # Server-side API, database, and logic
│   ├── src/
│   │   ├── middleware/           # JWT authentication and authorization
│   │   ├── routes/               # API route handlers (auth, forms, feedback, analytics, etc.)
│   │   └── utils/                # Crypto hashing and zero-dependency QR SVG generator
│   ├── data/
│   │   └── database.json         # JSON database with preloaded seed data
│   ├── tests/
│   │   └── cdp-responsive-test.js# Automated Edge CDP responsive test suite (107 checks)
│   ├── server.js                 # Express server & static asset host
│   └── package.json              # Backend package configuration
│
├── package.json                  # Root orchestration scripts (npm start, npm test)
└── README.md                     # Documentation & setup guide
```

---

## 🚀 Getting Started

### Start the Server
```bash
npm start
# Server runs at http://localhost:3000
```

### Accessing the Application
* **Dashboard & Admin App**: [http://localhost:3000](http://localhost:3000)
* **Public Customer Form**: [http://localhost:3000/feedback/apex-downtown](http://localhost:3000/feedback/apex-downtown)

### Demo Accounts & 1-Click Sign In
You can sign in using 1-click buttons in the top/drawer menu, or with these credentials:
* **Business Owner**: `sarah@apexcafe.com` / `Password@123`
* **Location Manager**: `marcus@apexcafe.com` / `Password@123`
* **Super Admin**: `admin@feedbackhub.com` / `Admin@123`

---

## 🧪 Automated Responsive Verification

The test suite runs real browser tests using Microsoft Edge via the Chrome DevTools Protocol (CDP) across all mandatory viewports:
```bash
npm test
```
The suite verifies:
* Viewport widths: 320px, 360px, 375px, 390px, 430px, 768px, 1024px, 1440px
* `scrollWidth <= clientWidth` on all 12 major pages
* Mobile navigation drawer open & auto-close
* Public customer feedback form star ratings and submission
* Form builder question addition & accessible reordering
* Complaint resolution & internal notes
* Zero browser console errors
