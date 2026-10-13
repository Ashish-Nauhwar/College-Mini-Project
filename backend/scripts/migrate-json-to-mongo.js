/**
 * Non-destructive Migration Script: JSON Database to MongoDB Atlas
 * Usage: node backend/scripts/migrate-json-to-mongo.js
 * 
 * Preserves the original JSON file and creates a backup copy.
 */

const path = require('path');
const fs = require('fs');
const dotenv = require('dotenv');
const mongoose = require('mongoose');

// Load environment variables
dotenv.config({ path: path.join(__dirname, '..', '.env') });

const { Business, User, Location, FeedbackForm, Feedback, AuditLog } = require('../src/models');

async function migrate() {
  const uri = process.env.MONGODB_URI;
  if (!uri || uri.includes('<username>') || uri.includes('<password>')) {
    console.error('[Error] MONGODB_URI is not set or contains placeholder credentials in backend/.env');
    process.exit(1);
  }

  const jsonPath = path.join(__dirname, '..', 'data', 'database.json');
  if (!fs.existsSync(jsonPath)) {
    console.error('[Error] JSON database file not found at:', jsonPath);
    process.exit(1);
  }

  // Backup original JSON file
  const backupPath = path.join(__dirname, '..', 'data', `database.backup-${Date.now()}.json`);
  fs.copyFileSync(jsonPath, backupPath);
  console.log(`[Backup] Safe backup created at: ${backupPath}`);

  const raw = fs.readFileSync(jsonPath, 'utf-8');
  const data = JSON.parse(raw);

  console.log('[Connecting] Connecting to MongoDB Atlas...');
  await mongoose.connect(uri);
  console.log('[Connected] Successfully connected to MongoDB Atlas.\n');

  const idMap = new Map(); // Old ID string -> New Mongo ObjectId

  // 1. Migrate Businesses
  console.log(`Migrating ${(data.businesses || []).length} businesses...`);
  for (const b of data.businesses || []) {
    const newDoc = new Business({
      name: b.name,
      type: b.type || (b.category?.toLowerCase().includes('cafe') ? 'restaurant' : 'other'),
      category: b.category,
      email: b.email,
      phone: b.phone,
      address: {
        addressLine1: b.address || '',
        city: 'Metropolis',
        state: 'State',
        postalCode: '10001',
        country: 'India'
      },
      logo: b.logo || '🏢',
      googleReviewUrl: b.googleReviewUrl || '',
      active: b.active !== false
    });
    await newDoc.save();
    idMap.set(b.id, newDoc._id);
  }

  // 2. Migrate Locations
  console.log(`Migrating ${(data.locations || []).length} locations...`);
  for (const l of data.locations || []) {
    const bizId = idMap.get(l.businessId);
    if (!bizId) continue;
    const newDoc = new Location({
      businessId: bizId,
      name: l.name,
      code: l.code || '',
      address: l.address,
      phone: l.phone || '',
      manager: l.manager || '',
      active: l.active !== false
    });
    await newDoc.save();
    idMap.set(l.id, newDoc._id);
  }

  // 3. Migrate Users
  console.log(`Migrating ${(data.users || []).length} users...`);
  for (const u of data.users || []) {
    const bizId = u.businessId ? idMap.get(u.businessId) : null;
    const newDoc = new User({
      name: u.name,
      email: u.email.toLowerCase(),
      password: u.password, // Pre-hashed
      role: u.role || 'owner',
      businessId: bizId,
      avatar: u.avatar || '👤'
    });
    await newDoc.save();
    idMap.set(u.id, newDoc._id);
  }

  // 4. Migrate Feedback Forms
  console.log(`Migrating ${(data.forms || []).length} feedback forms...`);
  for (const f of data.forms || []) {
    const bizId = idMap.get(f.businessId);
    if (!bizId) continue;
    const locId = f.locationId ? idMap.get(f.locationId) : null;

    const newDoc = new FeedbackForm({
      businessId: bizId,
      locationId: locId,
      slug: f.slug.toLowerCase(),
      title: f.title,
      description: f.description || '',
      formType: f.formType || 'general',
      status: f.status || 'published',
      googleReviewUrl: f.googleReviewUrl || '',
      questions: (f.questions || []).map((q, idx) => ({
        id: q.id || `q_${idx + 1}`,
        type: q.type,
        text: q.text,
        description: q.description || '',
        required: Boolean(q.required),
        min: q.min,
        max: q.max,
        options: q.options || [],
        multiline: Boolean(q.multiline),
        order: idx
      }))
    });
    await newDoc.save();
    idMap.set(f.id, newDoc._id);
  }

  // 5. Migrate Feedback Responses
  console.log(`Migrating ${(data.feedbacks || []).length} feedback records...`);
  for (const fb of data.feedbacks || []) {
    const bizId = idMap.get(fb.businessId);
    const formId = idMap.get(fb.formId);
    if (!bizId || !formId) continue;
    const locId = fb.locationId ? idMap.get(fb.locationId) : null;

    const answersMap = new Map();
    if (fb.answers) {
      for (const [k, v] of Object.entries(fb.answers)) {
        answersMap.set(k, v);
      }
    }

    const newDoc = new Feedback({
      businessId: bizId,
      formId: formId,
      locationId: locId,
      rating: fb.rating,
      sentiment: fb.sentiment || 'neutral',
      status: fb.status || 'new',
      priority: fb.priority || 'medium',
      customerName: fb.customerName || 'Anonymous',
      customerEmail: fb.customerEmail || '',
      customerPhone: fb.customerPhone || '',
      answers: answersMap,
      comments: fb.comments || '',
      assignedTo: fb.assignedTo || '',
      resolutionNotes: fb.resolutionNotes || '',
      internalNotes: (fb.internalNotes || []).map(n => ({
        text: n.text,
        author: n.author,
        createdAt: n.createdAt ? new Date(n.createdAt) : new Date()
      })),
      source: fb.source || 'QR Code',
      createdAt: fb.createdAt ? new Date(fb.createdAt) : new Date()
    });
    await newDoc.save();
  }

  // 6. Migrate Audit Logs
  console.log(`Migrating ${(data.auditLogs || []).length} audit logs...`);
  for (const a of data.auditLogs || []) {
    const newDoc = new AuditLog({
      action: a.action,
      actor: a.actor,
      details: a.details || '',
      createdAt: a.timestamp ? new Date(a.timestamp) : new Date()
    });
    await newDoc.save();
  }

  console.log('\n[SUCCESS] All JSON data safely migrated into MongoDB Atlas!');
  console.log('[Notice] Original JSON file was preserved at:', jsonPath);
  await mongoose.connection.close();
}

if (require.main === module) {
  migrate().catch(err => {
    console.error('[Migration Error]:', err);
    process.exit(1);
  });
}

module.exports = migrate;
