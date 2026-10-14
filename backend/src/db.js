/**
 * Persistent Database Layer using MongoDB Atlas & Mongoose
 * Enforces tenant data isolation, schema validation, and supports isolated test mode.
 */

const mongoose = require('mongoose');
const { Business, User, Location, FeedbackForm, Feedback, AuditLog } = require('./models');
const configDb = require('./config/db');

function isProduction() {
  return (process.env.NODE_ENV || 'development').trim().toLowerCase() === 'production';
}

// In production, mock DB mode is strictly prohibited under all circumstances
let mockDbMode = !isProduction() && process.env.TEST_MOCK_DB === 'true';

if (isProduction() && process.env.TEST_MOCK_DB === 'true') {
  console.error('\n===============================================================');
  console.error('[CRITICAL SECURITY ERROR] TEST_MOCK_DB=true is strictly forbidden in production (NODE_ENV=production).');
  console.error('Refusing to start with mock persistence in production environment.');
  console.error('===============================================================\n');
  throw new Error('[Security Error] Mock database mode cannot be activated when NODE_ENV=production.');
}

function isDbConnected() {
  if (isProduction()) {
    return configDb.isDbConnected();
  }
  if (mockDbMode) return true;
  return configDb.isDbConnected();
}

function isPersistentDbConnected() {
  return configDb.isDbConnected();
}

const mockStore = {
  users: new Map(),
  businesses: new Map(),
  locations: new Map(),
  forms: new Map(),
  feedbacks: new Map(),
  auditLogs: []
};

function enableMockDb(enable = true) {
  if (enable && isProduction()) {
    throw new Error('[Security Error] Mock database mode cannot be enabled when NODE_ENV=production.');
  }
  mockDbMode = Boolean(enable);
}

function clearMockDb() {
  mockStore.users.clear();
  mockStore.businesses.clear();
  mockStore.locations.clear();
  mockStore.forms.clear();
  mockStore.feedbacks.clear();
  mockStore.auditLogs.length = 0;
}

function isMockDbActive() {
  return mockDbMode;
}

function checkConnection() {
  if (mockDbMode) {
    if (isProduction()) {
      const error = new Error('[Security Error] In-memory mock storage is forbidden in production.');
      error.statusCode = 500;
      throw error;
    }
    return;
  }
  if (!configDb.isDbConnected()) {
    const isUriConfigured = Boolean(process.env.MONGODB_URI && !process.env.MONGODB_URI.includes('<username>'));
    const message = isUriConfigured
      ? 'Database service temporarily unavailable. The database is currently reconnecting or unreachable. Please try again shortly.'
      : 'Database connection unavailable. Please ensure MONGODB_URI is set correctly in your environment configuration.';
    const error = new Error(message);
    error.statusCode = 503;
    throw error;
  }
}

// --- Users ---
async function findUserByEmail(email) {
  checkConnection();
  if (!email) return null;
  const cleanEmail = email.toLowerCase().trim();
  if (mockDbMode) {
    return Array.from(mockStore.users.values()).find(u => u.email === cleanEmail) || null;
  }
  return User.findOne({ email: cleanEmail });
}

async function findUserById(id) {
  checkConnection();
  if (!id) return null;
  const idStr = id.toString();
  if (mockDbMode) {
    return mockStore.users.get(idStr) || null;
  }
  if (!mongoose.Types.ObjectId.isValid(id)) return null;
  return User.findById(id);
}

async function createUser(userData) {
  checkConnection();
  const cleanEmail = userData.email.toLowerCase().trim();
  if (mockDbMode) {
    const doc = new User({ ...userData, email: cleanEmail, _id: userData._id || new mongoose.Types.ObjectId() });
    const err = doc.validateSync();
    if (err) throw err;
    const obj = doc.toObject();
    obj._id = doc._id;
    obj.id = doc._id.toString();
    mockStore.users.set(obj.id, obj);
    return obj;
  }
  return User.create({
    ...userData,
    email: cleanEmail
  });
}

async function deleteUser(id) {
  checkConnection();
  if (!id) return null;
  const idStr = id.toString();
  if (mockDbMode) {
    mockStore.users.delete(idStr);
    return { deletedCount: 1 };
  }
  if (!mongoose.Types.ObjectId.isValid(id)) return null;
  return User.findByIdAndDelete(id);
}

async function getUsers(filter = {}) {
  checkConnection();
  if (mockDbMode) {
    return Array.from(mockStore.users.values());
  }
  return User.find(filter).select('-password').sort({ createdAt: -1 });
}

// --- Businesses ---
async function getBusinesses(filter = {}) {
  checkConnection();
  if (mockDbMode) {
    return Array.from(mockStore.businesses.values());
  }
  return Business.find(filter).sort({ createdAt: -1 });
}

async function getBusinessById(id) {
  checkConnection();
  if (!id) return null;
  const idStr = id.toString();
  if (mockDbMode) {
    return mockStore.businesses.get(idStr) || null;
  }
  if (!mongoose.Types.ObjectId.isValid(id)) return null;
  return Business.findById(id);
}

async function createBusiness(bizData) {
  checkConnection();
  if (mockDbMode) {
    const doc = new Business({ ...bizData, _id: bizData._id || new mongoose.Types.ObjectId() });
    const err = doc.validateSync();
    if (err) throw err;
    const obj = doc.toObject();
    obj._id = doc._id;
    obj.id = doc._id.toString();
    mockStore.businesses.set(obj.id, obj);
    return obj;
  }
  return Business.create(bizData);
}

async function updateBusiness(id, updates) {
  checkConnection();
  if (!id) return null;
  const idStr = id.toString();
  if (mockDbMode) {
    const curr = mockStore.businesses.get(idStr);
    if (!curr) return null;
    const updated = { ...curr, ...updates, updatedAt: new Date() };
    mockStore.businesses.set(idStr, updated);
    return updated;
  }
  if (!mongoose.Types.ObjectId.isValid(id)) return null;
  return Business.findByIdAndUpdate(id, updates, { returnDocument: 'after', runValidators: true });
}

async function findBusinessByEmail(email) {
  checkConnection();
  if (!email) return null;
  const cleanEmail = email.toLowerCase().trim();
  if (mockDbMode) {
    return Array.from(mockStore.businesses.values()).find(b => b.email === cleanEmail) || null;
  }
  return Business.findOne({ email: cleanEmail });
}

async function deleteBusiness(id) {
  checkConnection();
  if (!id) return null;
  const idStr = id.toString();
  if (mockDbMode) {
    mockStore.businesses.delete(idStr);
    return { deletedCount: 1 };
  }
  if (!mongoose.Types.ObjectId.isValid(id)) return null;
  return Business.findByIdAndDelete(id);
}

// --- Locations ---
async function getLocations(businessId) {
  checkConnection();
  if (mockDbMode) {
    const all = Array.from(mockStore.locations.values());
    return businessId ? all.filter(l => l.businessId.toString() === businessId.toString()) : all;
  }
  const filter = businessId ? { businessId } : {};
  return Location.find(filter).sort({ createdAt: -1 });
}

async function getLocationById(id) {
  checkConnection();
  if (!id) return null;
  const idStr = id.toString();
  if (mockDbMode) {
    return mockStore.locations.get(idStr) || null;
  }
  if (!mongoose.Types.ObjectId.isValid(id)) return null;
  return Location.findById(id);
}

async function createLocation(locationData) {
  checkConnection();
  if (mockDbMode) {
    const doc = new Location({ ...locationData, _id: locationData._id || new mongoose.Types.ObjectId() });
    const err = doc.validateSync();
    if (err) throw err;
    const obj = doc.toObject();
    obj._id = doc._id;
    obj.id = doc._id.toString();
    mockStore.locations.set(obj.id, obj);
    return obj;
  }
  return Location.create(locationData);
}

async function updateLocation(id, updates) {
  checkConnection();
  if (!id) return null;
  const idStr = id.toString();
  if (mockDbMode) {
    const curr = mockStore.locations.get(idStr);
    if (!curr) return null;
    const updated = { ...curr, ...updates, updatedAt: new Date() };
    mockStore.locations.set(idStr, updated);
    return updated;
  }
  if (!mongoose.Types.ObjectId.isValid(id)) return null;
  return Location.findByIdAndUpdate(id, updates, { returnDocument: 'after', runValidators: true });
}

async function deleteLocation(id) {
  checkConnection();
  if (!id) return null;
  const idStr = id.toString();
  if (mockDbMode) {
    const curr = mockStore.locations.get(idStr);
    mockStore.locations.delete(idStr);
    return curr || null;
  }
  if (!mongoose.Types.ObjectId.isValid(id)) return null;
  return Location.findByIdAndDelete(id);
}

// --- Feedback Forms ---
async function getForms(businessId, filter = {}) {
  checkConnection();
  if (mockDbMode) {
    let list = Array.from(mockStore.forms.values());
    if (businessId) list = list.filter(f => f.businessId.toString() === businessId.toString());
    return list;
  }
  const query = { ...filter };
  if (businessId) query.businessId = businessId;
  return FeedbackForm.find(query).sort({ createdAt: -1 });
}

async function getFormById(id) {
  checkConnection();
  if (!id) return null;
  const idStr = id.toString();
  if (mockDbMode) {
    return mockStore.forms.get(idStr) || null;
  }
  if (!mongoose.Types.ObjectId.isValid(id)) return null;
  return FeedbackForm.findById(id);
}

async function getFormBySlug(slug) {
  checkConnection();
  if (!slug) return null;
  const cleanSlug = slug.toLowerCase().trim();
  if (mockDbMode) {
    return Array.from(mockStore.forms.values()).find(f => f.slug === cleanSlug) || null;
  }
  return FeedbackForm.findOne({ slug: cleanSlug });
}

async function createForm(formData) {
  checkConnection();
  const cleanSlug = formData.slug.toLowerCase().trim();
  if (mockDbMode) {
    const doc = new FeedbackForm({ ...formData, slug: cleanSlug, _id: formData._id || new mongoose.Types.ObjectId() });
    const err = doc.validateSync();
    if (err) throw err;
    const obj = doc.toObject();
    obj._id = doc._id;
    obj.id = doc._id.toString();
    mockStore.forms.set(obj.id, obj);
    return obj;
  }
  return FeedbackForm.create({
    ...formData,
    slug: cleanSlug
  });
}

async function updateForm(id, updates) {
  checkConnection();
  if (!id) return null;
  const idStr = id.toString();
  if (mockDbMode) {
    const curr = mockStore.forms.get(idStr);
    if (!curr) return null;
    const updated = { ...curr, ...updates, updatedAt: new Date() };
    mockStore.forms.set(idStr, updated);
    return updated;
  }
  if (!mongoose.Types.ObjectId.isValid(id)) return null;
  return FeedbackForm.findByIdAndUpdate(id, updates, { returnDocument: 'after', runValidators: true });
}

async function deleteForm(id) {
  checkConnection();
  if (!id) return null;
  const idStr = id.toString();
  if (mockDbMode) {
    const curr = mockStore.forms.get(idStr);
    mockStore.forms.delete(idStr);
    return curr || null;
  }
  if (!mongoose.Types.ObjectId.isValid(id)) return null;
  return FeedbackForm.findByIdAndDelete(id);
}

// --- Feedback Submissions ---
async function getFeedbacks(filter = {}) {
  checkConnection();
  if (mockDbMode) {
    let list = Array.from(mockStore.feedbacks.values());
    if (filter.businessId) list = list.filter(f => f.businessId.toString() === filter.businessId.toString());
    if (filter.formId) list = list.filter(f => f.formId.toString() === filter.formId.toString());
    if (filter.locationId) list = list.filter(f => f.locationId && f.locationId.toString() === filter.locationId.toString());
    if (filter.status && filter.status !== 'all') list = list.filter(f => f.status === filter.status);
    if (filter.priority && filter.priority !== 'all') list = list.filter(f => f.priority === filter.priority);
    if (filter.sentiment && filter.sentiment !== 'all') list = list.filter(f => f.sentiment === filter.sentiment);
    if (filter.rating && filter.rating !== 'all') list = list.filter(f => f.rating === filter.rating);
    return list.sort((a, b) => new Date(b.createdAt || 0) - new Date(a.createdAt || 0));
  }
  return Feedback.find(filter).sort({ createdAt: -1 });
}

async function getFeedbackById(id) {
  checkConnection();
  if (!id) return null;
  const idStr = id.toString();
  if (mockDbMode) {
    return mockStore.feedbacks.get(idStr) || null;
  }
  if (!mongoose.Types.ObjectId.isValid(id)) return null;
  return Feedback.findById(id);
}

async function createFeedback(data) {
  checkConnection();
  if (mockDbMode) {
    const doc = new Feedback({
      ...data,
      _id: data._id || new mongoose.Types.ObjectId(),
      createdAt: data.createdAt || new Date(),
      updatedAt: new Date()
    });
    const err = doc.validateSync();
    if (err) throw err;
    const obj = doc.toObject();
    obj._id = doc._id;
    obj.id = doc._id.toString();
    mockStore.feedbacks.set(obj.id, obj);
    return obj;
  }
  return Feedback.create(data);
}

async function updateFeedback(id, updates) {
  checkConnection();
  if (!id) return null;
  const idStr = id.toString();
  if (mockDbMode) {
    const curr = mockStore.feedbacks.get(idStr);
    if (!curr) return null;
    const updated = { ...curr, ...updates, updatedAt: new Date() };
    mockStore.feedbacks.set(idStr, updated);
    return updated;
  }
  if (!mongoose.Types.ObjectId.isValid(id)) return null;
  return Feedback.findByIdAndUpdate(id, updates, { returnDocument: 'after', runValidators: true });
}

async function deleteFeedback(id) {
  checkConnection();
  if (!id) return null;
  const idStr = id.toString();
  if (mockDbMode) {
    const curr = mockStore.feedbacks.get(idStr);
    mockStore.feedbacks.delete(idStr);
    return curr || null;
  }
  if (!mongoose.Types.ObjectId.isValid(id)) return null;
  return Feedback.findByIdAndDelete(id);
}

// --- Audit Logs ---
async function logAudit(action, actor, details = '', businessId = null, ip = '') {
  if (mockDbMode) {
    mockStore.auditLogs.push({ action, actor, details, businessId, ip, createdAt: new Date() });
    return { action, actor, details };
  }
  if (!isDbConnected()) return null;
  try {
    return await AuditLog.create({
      action,
      actor,
      details,
      businessId,
      ip
    });
  } catch (err) {
    console.error('[AuditLog Error]:', err.message);
    return null;
  }
}

async function getAuditLogs(filter = {}, limit = 100) {
  checkConnection();
  if (mockDbMode) {
    return mockStore.auditLogs.slice(-limit).reverse();
  }
  return AuditLog.find(filter).sort({ createdAt: -1 }).limit(limit);
}

module.exports = {
  checkConnection,
  enableMockDb,
  clearMockDb,
  isMockDbActive,
  findUserByEmail,
  findUserById,
  createUser,
  deleteUser,
  getUsers,
  getBusinesses,
  getBusinessById,
  findBusinessByEmail,
  createBusiness,
  updateBusiness,
  deleteBusiness,
  getLocations,
  getLocationById,
  createLocation,
  updateLocation,
  deleteLocation,
  getForms,
  getFormById,
  getFormBySlug,
  createForm,
  updateForm,
  deleteForm,
  getFeedbacks,
  getFeedbackById,
  createFeedback,
  updateFeedback,
  deleteFeedback,
  logAudit,
  getAuditLogs,
  isDbConnected,
  isPersistentDbConnected
};
