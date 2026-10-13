/**
 * Persistent Database Layer using MongoDB Atlas & Mongoose
 * Enforces tenant data isolation and schema validation.
 */

const mongoose = require('mongoose');
const { Business, User, Location, FeedbackForm, Feedback, AuditLog } = require('./models');
const { isDbConnected } = require('./config/db');

function checkConnection() {
  if (!isDbConnected()) {
    const error = new Error('Database connection unavailable. Please ensure MONGODB_URI is set correctly in backend/.env.');
    error.statusCode = 503;
    throw error;
  }
}

// --- Users ---
async function findUserByEmail(email) {
  checkConnection();
  if (!email) return null;
  return User.findOne({ email: email.toLowerCase().trim() });
}

async function findUserById(id) {
  checkConnection();
  if (!id || !mongoose.Types.ObjectId.isValid(id)) return null;
  return User.findById(id);
}

async function createUser(userData) {
  checkConnection();
  return User.create({
    ...userData,
    email: userData.email.toLowerCase().trim()
  });
}

async function getUsers(filter = {}) {
  checkConnection();
  return User.find(filter).select('-password').sort({ createdAt: -1 });
}

// --- Businesses ---
async function getBusinesses(filter = {}) {
  checkConnection();
  return Business.find(filter).sort({ createdAt: -1 });
}

async function getBusinessById(id) {
  checkConnection();
  if (!id || !mongoose.Types.ObjectId.isValid(id)) return null;
  return Business.findById(id);
}

async function createBusiness(bizData) {
  checkConnection();
  return Business.create(bizData);
}

async function updateBusiness(id, updates) {
  checkConnection();
  if (!id || !mongoose.Types.ObjectId.isValid(id)) return null;
  return Business.findByIdAndUpdate(id, updates, { new: true, runValidators: true });
}

// --- Locations ---
async function getLocations(businessId) {
  checkConnection();
  const filter = businessId ? { businessId } : {};
  return Location.find(filter).sort({ createdAt: -1 });
}

async function getLocationById(id) {
  checkConnection();
  if (!id || !mongoose.Types.ObjectId.isValid(id)) return null;
  return Location.findById(id);
}

async function createLocation(locationData) {
  checkConnection();
  return Location.create(locationData);
}

async function updateLocation(id, updates) {
  checkConnection();
  if (!id || !mongoose.Types.ObjectId.isValid(id)) return null;
  return Location.findByIdAndUpdate(id, updates, { new: true, runValidators: true });
}

async function deleteLocation(id) {
  checkConnection();
  if (!id || !mongoose.Types.ObjectId.isValid(id)) return null;
  return Location.findByIdAndDelete(id);
}

// --- Feedback Forms ---
async function getForms(businessId, filter = {}) {
  checkConnection();
  const query = { ...filter };
  if (businessId) query.businessId = businessId;
  return FeedbackForm.find(query).sort({ createdAt: -1 });
}

async function getFormById(id) {
  checkConnection();
  if (!id || !mongoose.Types.ObjectId.isValid(id)) return null;
  return FeedbackForm.findById(id);
}

async function getFormBySlug(slug) {
  checkConnection();
  if (!slug) return null;
  return FeedbackForm.findOne({ slug: slug.toLowerCase().trim() });
}

async function createForm(formData) {
  checkConnection();
  return FeedbackForm.create({
    ...formData,
    slug: formData.slug.toLowerCase().trim()
  });
}

async function updateForm(id, updates) {
  checkConnection();
  if (!id || !mongoose.Types.ObjectId.isValid(id)) return null;
  return FeedbackForm.findByIdAndUpdate(id, updates, { new: true, runValidators: true });
}

async function deleteForm(id) {
  checkConnection();
  if (!id || !mongoose.Types.ObjectId.isValid(id)) return null;
  return FeedbackForm.findByIdAndDelete(id);
}

// --- Feedback Submissions ---
async function getFeedbacks(filter = {}) {
  checkConnection();
  return Feedback.find(filter).sort({ createdAt: -1 });
}

async function getFeedbackById(id) {
  checkConnection();
  if (!id || !mongoose.Types.ObjectId.isValid(id)) return null;
  return Feedback.findById(id);
}

async function createFeedback(data) {
  checkConnection();
  return Feedback.create(data);
}

async function updateFeedback(id, updates) {
  checkConnection();
  if (!id || !mongoose.Types.ObjectId.isValid(id)) return null;
  return Feedback.findByIdAndUpdate(id, updates, { new: true, runValidators: true });
}

async function deleteFeedback(id) {
  checkConnection();
  if (!id || !mongoose.Types.ObjectId.isValid(id)) return null;
  return Feedback.findByIdAndDelete(id);
}

// --- Audit Logs ---
async function logAudit(action, actor, details = '', businessId = null, ip = '') {
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
  return AuditLog.find(filter).sort({ createdAt: -1 }).limit(limit);
}

module.exports = {
  checkConnection,
  findUserByEmail,
  findUserById,
  createUser,
  getUsers,
  getBusinesses,
  getBusinessById,
  createBusiness,
  updateBusiness,
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
  getAuditLogs
};
