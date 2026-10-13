# FeedbackHub - Frontend Client Application

Mobile-first responsive presentation layer for FeedbackHub Customer Experience Management platform.

## 📱 Features

- **Mobile-First Responsive Design (320px – 1440px+)**: Tested and verified on all smartphone screen sizes (iPhone SE, Galaxy, iPhone 14/15 Pro Max), tablets, and high-resolution desktop displays with zero horizontal scrolling.
- **Single Page Application (SPA)**: Hash-based client-side routing (`#/dashboard`, `#/inbox`, `#/builder`, `#/analytics`, `#/qr`, `#/locations`, `#/settings`, `#/admin`).
- **Interactive QR Code Generator**: Offline-ready, zero-dependency QR code generator with real-time rendering, high-resolution PNG download, and copy link functionality.
- **Public Customer Feedback Form**: High-speed, mobile-optimized form with 44px+ touch-friendly star ratings, 0-10 NPS slider, and dynamic question rendering.
- **Dashboard & Analytics**: Real-time charts, satisfaction metrics, sentiment distribution, and store performance cards.
- **Form Builder**: Visual questionnaire editor with accessible up/down ordering buttons and live mobile preview.
- **Settings & Profile Management**: Real-time business profile editing connected directly to the backend API.

## 📁 Directory Layout

```
frontend/
├── css/
│   └── style.css          # Mobile-first CSS design system & touch variables
├── js/
│   ├── app.js             # Core SPA controller (dashboard, builder, settings, QR)
│   ├── feedback.js        # Public customer QR form controller
│   └── qr.js              # Self-contained zero-dependency QR code engine
├── index.html             # Main dashboard, admin, and management portal
├── feedback.html          # Public customer feedback form
├── package.json           # Frontend package configuration
├── node_modules/          # Frontend local node modules
└── README.md              # Frontend documentation
```

## 🚀 Running the Frontend

The frontend is served directly by the backend server:

```bash
# Start backend server serving frontend assets
npm start
```

Access at `http://localhost:3000`.
