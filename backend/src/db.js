const fs = require('fs');
const path = require('path');
const { hashPassword } = require('./utils/crypto');

const DB_FILE = path.join(__dirname, '..', 'data', 'database.json');

// Ensure data folder exists
const dataDir = path.dirname(DB_FILE);
if (!fs.existsSync(dataDir)) {
  fs.mkdirSync(dataDir, { recursive: true });
}

function getInitialData() {
  const defaultPasswordHash = hashPassword('Password@123');
  const adminPasswordHash = hashPassword('Admin@123');

  return {
    businesses: [
      {
        id: 'biz-1',
        name: 'Apex Specialty Coffee & Roasters',
        category: 'Cafe & Restaurant',
        address: '104 Market Street, Downtown Arts District',
        phone: '+1 (555) 234-5678',
        email: 'hello@apexcafe.com',
        website: 'https://apexspecialtycoffee.demo',
        logo: '☕',
        active: true,
        createdAt: '2026-09-01T08:00:00.000Z'
      },
      {
        id: 'biz-2',
        name: 'Nexus Health & Wellness Clinic',
        category: 'Healthcare & Wellness',
        address: '450 Medical Arts Plaza, Suite 300',
        phone: '+1 (555) 876-5432',
        email: 'care@nexusclinic.demo',
        website: 'https://nexusclinic.demo',
        logo: '🏥',
        active: true,
        createdAt: '2026-09-15T10:00:00.000Z'
      }
    ],
    users: [
      {
        id: 'usr-admin',
        name: 'System Administrator',
        email: 'admin@feedbackhub.com',
        password: adminPasswordHash,
        role: 'superadmin',
        businessId: null,
        avatar: '🛡️',
        createdAt: '2026-08-01T00:00:00.000Z'
      },
      {
        id: 'usr-sarah',
        name: 'Sarah Jenkins',
        email: 'sarah@apexcafe.com',
        password: defaultPasswordHash,
        role: 'owner',
        businessId: 'biz-1',
        avatar: '👩‍💼',
        createdAt: '2026-09-01T08:00:00.000Z'
      },
      {
        id: 'usr-marcus',
        name: 'Marcus Vance',
        email: 'marcus@apexcafe.com',
        password: defaultPasswordHash,
        role: 'manager',
        businessId: 'biz-1',
        avatar: '👨‍💼',
        createdAt: '2026-09-05T09:30:00.000Z'
      },
      {
        id: 'usr-elena',
        name: 'Dr. Elena Rostova',
        email: 'elena@nexusclinic.com',
        password: defaultPasswordHash,
        role: 'owner',
        businessId: 'biz-2',
        avatar: '👩‍⚕️',
        createdAt: '2026-09-15T10:00:00.000Z'
      }
    ],
    locations: [
      {
        id: 'loc-1',
        businessId: 'biz-1',
        name: 'Downtown Flagship',
        code: 'DT-01',
        address: '104 Market Street, Downtown',
        phone: '+1 (555) 234-5678',
        manager: 'Marcus Vance',
        active: true,
        createdAt: '2026-09-01T08:30:00.000Z'
      },
      {
        id: 'loc-2',
        businessId: 'biz-1',
        name: 'Airport Terminal 2',
        code: 'AP-02',
        address: 'Concourse B, Departure Gate 14',
        phone: '+1 (555) 234-5679',
        manager: 'Elena Diaz',
        active: true,
        createdAt: '2026-09-10T11:00:00.000Z'
      },
      {
        id: 'loc-3',
        businessId: 'biz-1',
        name: 'Westside Mall',
        code: 'WM-03',
        address: 'Level 2, Center Atrium Food Court',
        phone: '+1 (555) 234-5680',
        manager: 'David Chen',
        active: true,
        createdAt: '2026-09-20T14:15:00.000Z'
      }
    ],
    forms: [
      {
        id: 'form-1',
        slug: 'apex-downtown',
        businessId: 'biz-1',
        locationId: 'loc-1',
        title: 'Downtown Flagship Customer Experience',
        description: 'Thank you for visiting Apex Specialty Coffee! We value your honest thoughts to help us brew your day better.',
        status: 'published', // 'published' | 'paused'
        googleReviewUrl: 'https://g.page/r/demo-apex-coffee/review',
        questions: [
          {
            id: 'q1',
            type: 'rating',
            text: 'How would you rate your overall experience today?',
            required: true,
            min: 1,
            max: 5
          },
          {
            id: 'q2',
            type: 'nps',
            text: 'How likely are you to recommend Apex Coffee to a friend or colleague?',
            required: true,
            min: 0,
            max: 10
          },
          {
            id: 'q3',
            type: 'choice',
            text: 'What did you order today?',
            options: ['Hand-poured Single Origin Coffee', 'Signature Espresso / Flat White', 'Fresh Bakery & Artisanal Pastry', 'Bag of Whole Bean Coffee to go'],
            required: false
          },
          {
            id: 'q4',
            type: 'yesno',
            text: 'Was your order served promptly and with friendly hospitality?',
            required: false
          },
          {
            id: 'q5',
            type: 'text',
            text: 'What did you love most or how can we improve?',
            placeholder: 'Tell us about the coffee, service, seating, or music...',
            required: false,
            multiline: true
          }
        ],
        createdAt: '2026-09-02T10:00:00.000Z',
        updatedAt: '2026-10-01T12:00:00.000Z'
      },
      {
        id: 'form-2',
        slug: 'apex-airport',
        businessId: 'biz-1',
        locationId: 'loc-2',
        title: 'Airport Express Quick Feedback',
        description: 'Grabbed a quick pre-flight coffee? Let us know how quickly and smoothly we served you.',
        status: 'published',
        googleReviewUrl: 'https://g.page/r/demo-apex-airport/review',
        questions: [
          {
            id: 'q1',
            type: 'rating',
            text: 'Overall speed and service quality:',
            required: true,
            min: 1,
            max: 5
          },
          {
            id: 'q2',
            type: 'yesno',
            text: 'Was the wait time under 3 minutes?',
            required: true
          },
          {
            id: 'q3',
            type: 'text',
            text: 'Any quick feedback for our airport crew?',
            required: false,
            multiline: true
          }
        ],
        createdAt: '2026-09-12T09:00:00.000Z',
        updatedAt: '2026-09-12T09:00:00.000Z'
      }
    ],
    feedbacks: [
      {
        id: 'fb-101',
        businessId: 'biz-1',
        locationId: 'loc-1',
        formId: 'form-1',
        rating: 5,
        nps: 10,
        sentiment: 'positive',
        customerName: 'Alexander Hayes',
        customerEmail: 'alex.hayes@example.com',
        customerPhone: '+1 (555) 782-9012',
        comments: 'Outstanding single-origin Ethiopian pour-over! The floral notes were unbelievable and Marcus was delightful at the counter.',
        answers: {
          q1: 5,
          q2: 10,
          q3: 'Hand-poured Single Origin Coffee',
          q4: 'yes',
          q5: 'Outstanding single-origin Ethiopian pour-over! The floral notes were unbelievable and Marcus was delightful at the counter.'
        },
        status: 'resolved',
        priority: 'low',
        assignedTo: 'Marcus Vance',
        internalNotes: [
          {
            id: 'note-1',
            author: 'Marcus Vance',
            text: 'Customer loved the Guji batch! Shared commendation with the morning baristas.',
            createdAt: '2026-10-09T14:22:00.000Z'
          }
        ],
        resolution: {
          resolvedBy: 'Marcus Vance',
          resolvedAt: '2026-10-09T14:25:00.000Z',
          resolutionNote: 'Customer delighted. Sent thank-you card.'
        },
        source: 'QR Code (Table #4)',
        createdAt: '2026-10-09T13:40:00.000Z'
      },
      {
        id: 'fb-102',
        businessId: 'biz-1',
        locationId: 'loc-1',
        formId: 'form-1',
        rating: 2,
        nps: 3,
        sentiment: 'negative',
        customerName: 'Sophia Lin',
        customerEmail: 'sophia.lin@testmail.com',
        customerPhone: '+1 (555) 349-1120',
        comments: 'Waited almost 20 minutes for an oat flat white, and when it arrived the temperature was barely lukewarm. Very frustrating when on a tight lunch break.',
        answers: {
          q1: 2,
          q2: 3,
          q3: 'Signature Espresso / Flat White',
          q4: 'no',
          q5: 'Waited almost 20 minutes for an oat flat white, and when it arrived the temperature was barely lukewarm. Very frustrating when on a tight lunch break.'
        },
        status: 'in_review',
        priority: 'urgent',
        assignedTo: 'Marcus Vance',
        internalNotes: [
          {
            id: 'note-2',
            author: 'Sarah Jenkins',
            text: 'Rush hour backlog on machine #2 steam wand. Marcus please reach out to Sophia directly with an apology and a voucher.',
            createdAt: '2026-10-10T10:15:00.000Z'
          }
        ],
        resolution: null,
        source: 'QR Code (Receipt)',
        createdAt: '2026-10-10T09:45:00.000Z'
      },
      {
        id: 'fb-103',
        businessId: 'biz-1',
        locationId: 'loc-1',
        formId: 'form-1',
        rating: 4,
        nps: 8,
        sentiment: 'positive',
        customerName: 'Jordan Miller',
        customerEmail: 'jordan.m@webmail.org',
        customerPhone: '',
        comments: 'Vibe is pristine and music playlist is top notch. Great place to get laptop work done. Pastry was slightly crumbly but good flavor.',
        answers: {
          q1: 4,
          q2: 8,
          q3: 'Fresh Bakery & Artisanal Pastry',
          q4: 'yes',
          q5: 'Vibe is pristine and music playlist is top notch. Great place to get laptop work done. Pastry was slightly crumbly but good flavor.'
        },
        status: 'new',
        priority: 'medium',
        assignedTo: null,
        internalNotes: [],
        resolution: null,
        source: 'QR Code (Counter Display)',
        createdAt: '2026-10-11T11:20:00.000Z'
      },
      {
        id: 'fb-104',
        businessId: 'biz-1',
        locationId: 'loc-2',
        formId: 'form-2',
        rating: 5,
        nps: 9,
        sentiment: 'positive',
        customerName: 'Emily Watson',
        customerEmail: 'emily.watson@flytravel.com',
        customerPhone: '+1 (555) 671-8899',
        comments: 'Blazing fast service! Got my double shot cortado in 90 seconds flat. Life saver before a 6 hour flight.',
        answers: {
          q1: 5,
          q2: 'yes',
          q3: 'Blazing fast service! Got my double shot cortado in 90 seconds flat. Life saver before a 6 hour flight.'
        },
        status: 'resolved',
        priority: 'low',
        assignedTo: 'Sarah Jenkins',
        internalNotes: [],
        resolution: {
          resolvedBy: 'Sarah Jenkins',
          resolvedAt: '2026-10-11T12:00:00.000Z',
          resolutionNote: 'Reviewed and closed.'
        },
        source: 'QR Code (Grab & Go Kiosk)',
        createdAt: '2026-10-11T08:15:00.000Z'
      },
      {
        id: 'fb-105',
        businessId: 'biz-1',
        locationId: 'loc-1',
        formId: 'form-1',
        rating: 1,
        nps: 1,
        sentiment: 'negative',
        customerName: 'Daniel Vance',
        customerEmail: 'dvance@corpnet.net',
        customerPhone: '+1 (555) 991-4433',
        comments: 'Spilled coffee because the lid was cracked and not fitted properly. Got all over my jacket.',
        answers: {
          q1: 1,
          q2: 1,
          q3: 'Signature Espresso / Flat White',
          q4: 'no',
          q5: 'Spilled coffee because the lid was cracked and not fitted properly. Got all over my jacket.'
        },
        status: 'new',
        priority: 'critical',
        assignedTo: 'Marcus Vance',
        internalNotes: [
          {
            id: 'note-3',
            author: 'System Alert',
            text: 'Urgent 1-Star alert triggered automatically. Follow-up SLA: within 2 hours.',
            createdAt: '2026-10-11T16:05:00.000Z'
          }
        ],
        resolution: null,
        source: 'QR Code (Table #11)',
        createdAt: '2026-10-11T16:04:00.000Z'
      },
      {
        id: 'fb-106',
        businessId: 'biz-1',
        locationId: 'loc-3',
        formId: 'form-1',
        rating: 3,
        nps: 6,
        sentiment: 'neutral',
        customerName: 'Rachel Green',
        customerEmail: 'rachel.g@citylife.io',
        customerPhone: '',
        comments: 'Average cup today. Beans tasted a bit overly dark roasted compared to the downtown branch.',
        answers: {
          q1: 3,
          q2: 6,
          q3: 'Hand-poured Single Origin Coffee',
          q4: 'yes',
          q5: 'Average cup today. Beans tasted a bit overly dark roasted compared to the downtown branch.'
        },
        status: 'in_review',
        priority: 'medium',
        assignedTo: null,
        internalNotes: [],
        resolution: null,
        source: 'QR Code (Table Tent)',
        createdAt: '2026-10-11T18:30:00.000Z'
      }
    ],
    auditLogs: [
      {
        id: 'aud-1',
        action: 'Form Published',
        user: 'Sarah Jenkins',
        details: 'Published Downtown Flagship Customer Experience form (apex-downtown)',
        timestamp: '2026-09-02T10:00:00.000Z'
      },
      {
        id: 'aud-2',
        action: 'Location Added',
        user: 'Sarah Jenkins',
        details: 'Added location Airport Terminal 2 (AP-02)',
        timestamp: '2026-09-10T11:00:00.000Z'
      },
      {
        id: 'aud-3',
        action: 'Complaint Resolved',
        user: 'Marcus Vance',
        details: 'Resolved feedback fb-101 for Alexander Hayes',
        timestamp: '2026-10-09T14:25:00.000Z'
      },
      {
        id: 'aud-4',
        action: 'Internal Note Added',
        user: 'Sarah Jenkins',
        details: 'Added follow-up note to feedback fb-102 (Sophia Lin)',
        timestamp: '2026-10-10T10:15:00.000Z'
      }
    ]
  };
}

class Database {
  constructor() {
    this.data = null;
    this.init();
  }

  init() {
    if (!fs.existsSync(DB_FILE)) {
      this.data = getInitialData();
      this.save();
    } else {
      try {
        const raw = fs.readFileSync(DB_FILE, 'utf-8');
        this.data = JSON.parse(raw);
      } catch (err) {
        console.error('Error reading database, resetting to default:', err);
        this.data = getInitialData();
        this.save();
      }
    }
  }

  save() {
    fs.writeFileSync(DB_FILE, JSON.stringify(this.data, null, 2), 'utf-8');
  }

  reset() {
    this.data = getInitialData();
    this.save();
    return this.data;
  }

  // --- Users ---
  findUserByEmail(email) {
    return this.data.users.find(u => u.email.toLowerCase() === email.toLowerCase());
  }

  findUserById(id) {
    return this.data.users.find(u => u.id === id);
  }

  getUsers(businessId = null) {
    if (!businessId) return this.data.users;
    return this.data.users.filter(u => u.businessId === businessId || u.role === 'superadmin');
  }

  createUser(userData) {
    const newUser = {
      id: 'usr-' + Date.now() + '-' + Math.random().toString(36).substring(2, 6),
      ...userData,
      createdAt: new Date().toISOString()
    };
    this.data.users.push(newUser);
    this.save();
    return newUser;
  }

  // --- Businesses ---
  getBusinesses() {
    return this.data.businesses;
  }

  getBusinessById(id) {
    return this.data.businesses.find(b => b.id === id);
  }

  updateBusiness(id, updates) {
    const idx = this.data.businesses.findIndex(b => b.id === id);
    if (idx !== -1) {
      this.data.businesses[idx] = { ...this.data.businesses[idx], ...updates };
      this.save();
      return this.data.businesses[idx];
    }
    return null;
  }

  createBusiness(bizData) {
    const newBiz = {
      id: 'biz-' + Date.now() + '-' + Math.random().toString(36).substring(2, 6),
      active: true,
      createdAt: new Date().toISOString(),
      ...bizData
    };
    this.data.businesses.push(newBiz);
    this.save();
    return newBiz;
  }

  // --- Locations ---
  getLocations(businessId) {
    if (!businessId) return this.data.locations;
    return this.data.locations.filter(l => l.businessId === businessId);
  }

  getLocationById(id) {
    return this.data.locations.find(l => l.id === id);
  }

  createLocation(locationData) {
    const newLoc = {
      id: 'loc-' + Date.now() + '-' + Math.random().toString(36).substring(2, 6),
      active: true,
      createdAt: new Date().toISOString(),
      ...locationData
    };
    this.data.locations.push(newLoc);
    this.save();
    return newLoc;
  }

  updateLocation(id, updates) {
    const idx = this.data.locations.findIndex(l => l.id === id);
    if (idx !== -1) {
      this.data.locations[idx] = { ...this.data.locations[idx], ...updates };
      this.save();
      return this.data.locations[idx];
    }
    return null;
  }

  deleteLocation(id) {
    const idx = this.data.locations.findIndex(l => l.id === id);
    if (idx !== -1) {
      this.data.locations.splice(idx, 1);
      this.save();
      return true;
    }
    return false;
  }

  // --- Forms ---
  getForms(businessId) {
    if (!businessId) return this.data.forms;
    return this.data.forms.filter(f => f.businessId === businessId);
  }

  getFormById(id) {
    return this.data.forms.find(f => f.id === id);
  }

  getFormBySlug(slug) {
    return this.data.forms.find(f => f.slug.toLowerCase() === slug.toLowerCase());
  }

  createForm(formData) {
    const newForm = {
      id: 'form-' + Date.now() + '-' + Math.random().toString(36).substring(2, 6),
      status: formData.status || 'published',
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
      ...formData
    };
    this.data.forms.push(newForm);
    this.save();
    return newForm;
  }

  updateForm(id, updates) {
    const idx = this.data.forms.findIndex(f => f.id === id);
    if (idx !== -1) {
      this.data.forms[idx] = {
        ...this.data.forms[idx],
        ...updates,
        updatedAt: new Date().toISOString()
      };
      this.save();
      return this.data.forms[idx];
    }
    return null;
  }

  deleteForm(id) {
    const idx = this.data.forms.findIndex(f => f.id === id);
    if (idx !== -1) {
      this.data.forms.splice(idx, 1);
      this.save();
      return true;
    }
    return false;
  }

  // --- Feedbacks ---
  getFeedbacks(filter = {}) {
    let list = [...this.data.feedbacks];

    if (filter.businessId) {
      list = list.filter(fb => fb.businessId === filter.businessId);
    }
    if (filter.locationId && filter.locationId !== 'all') {
      list = list.filter(fb => fb.locationId === filter.locationId);
    }
    if (filter.rating && filter.rating !== 'all') {
      list = list.filter(fb => fb.rating === parseInt(filter.rating, 10));
    }
    if (filter.status && filter.status !== 'all') {
      list = list.filter(fb => fb.status === filter.status);
    }
    if (filter.priority && filter.priority !== 'all') {
      list = list.filter(fb => fb.priority === filter.priority);
    }
    if (filter.sentiment && filter.sentiment !== 'all') {
      list = list.filter(fb => fb.sentiment === filter.sentiment);
    }
    if (filter.search) {
      const q = filter.search.toLowerCase();
      list = list.filter(fb =>
        (fb.customerName && fb.customerName.toLowerCase().includes(q)) ||
        (fb.comments && fb.comments.toLowerCase().includes(q)) ||
        (fb.customerEmail && fb.customerEmail.toLowerCase().includes(q))
      );
    }

    // Sort newest first
    list.sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt));
    return list;
  }

  getFeedbackById(id) {
    return this.data.feedbacks.find(fb => fb.id === id);
  }

  createFeedback(feedbackData) {
    const rating = parseInt(feedbackData.rating || 5, 10);
    let sentiment = 'positive';
    let priority = 'low';

    if (rating <= 2) {
      sentiment = 'negative';
      priority = rating === 1 ? 'critical' : 'urgent';
    } else if (rating === 3) {
      sentiment = 'neutral';
      priority = 'medium';
    } else {
      sentiment = 'positive';
      priority = 'low';
    }

    const newFeedback = {
      id: 'fb-' + Date.now() + '-' + Math.random().toString(36).substring(2, 6),
      sentiment,
      priority,
      status: 'new',
      assignedTo: null,
      internalNotes: [],
      resolution: null,
      createdAt: new Date().toISOString(),
      ...feedbackData,
      rating
    };

    this.data.feedbacks.push(newFeedback);
    this.save();
    return newFeedback;
  }

  updateFeedback(id, updates) {
    const idx = this.data.feedbacks.findIndex(fb => fb.id === id);
    if (idx !== -1) {
      this.data.feedbacks[idx] = { ...this.data.feedbacks[idx], ...updates };
      this.save();
      return this.data.feedbacks[idx];
    }
    return null;
  }

  addFeedbackNote(id, note) {
    const fb = this.getFeedbackById(id);
    if (fb) {
      if (!fb.internalNotes) fb.internalNotes = [];
      const newNote = {
        id: 'note-' + Date.now(),
        createdAt: new Date().toISOString(),
        ...note
      };
      fb.internalNotes.push(newNote);
      this.save();
      return newNote;
    }
    return null;
  }

  resolveFeedback(id, resolutionData) {
    const fb = this.getFeedbackById(id);
    if (fb) {
      fb.status = 'resolved';
      fb.resolution = {
        resolvedAt: new Date().toISOString(),
        ...resolutionData
      };
      this.save();
      return fb;
    }
    return null;
  }

  // --- Audit Logs ---
  getAuditLogs() {
    return [...this.data.auditLogs].sort((a, b) => new Date(b.timestamp) - new Date(a.timestamp));
  }

  logAudit(action, user, details) {
    const log = {
      id: 'aud-' + Date.now(),
      action,
      user: typeof user === 'string' ? user : (user?.name || 'System'),
      details,
      timestamp: new Date().toISOString()
    };
    this.data.auditLogs.unshift(log);
    // Keep last 200 logs
    if (this.data.auditLogs.length > 200) {
      this.data.auditLogs.pop();
    }
    this.save();
    return log;
  }
}

module.exports = new Database();
