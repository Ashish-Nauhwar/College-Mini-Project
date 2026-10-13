const mongoose = require('mongoose');

const internalNoteSchema = new mongoose.Schema(
  {
    text: { type: String, required: true, trim: true },
    author: { type: String, required: true, trim: true },
    createdAt: { type: Date, default: Date.now }
  },
  { _id: true }
);

const academicDetailsSchema = new mongoose.Schema(
  {
    department: { type: String, trim: true },
    course: { type: String, trim: true },
    academicYear: { type: String, trim: true },
    yearOfStudy: { type: String, trim: true },
    semester: { type: String, trim: true },
    section: { type: String, trim: true },
    faculty: { type: String, trim: true },
    subject: { type: String, trim: true },
    category: { type: String, trim: true }
  },
  { _id: false }
);

const feedbackSchema = new mongoose.Schema(
  {
    businessId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'Business',
      required: [true, 'Business ID is required'],
      index: true
    },
    formId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'FeedbackForm',
      required: [true, 'Form ID is required'],
      index: true
    },
    locationId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'Location',
      default: null,
      index: true
    },
    rating: {
      type: Number,
      min: 1,
      max: 5,
      default: null,
      index: true
    },
    nps: {
      type: Number,
      min: 0,
      max: 10,
      default: null,
      index: true
    },
    npsAnswers: {
      type: Map,
      of: Number,
      default: () => new Map()
    },
    sentiment: {
      type: String,
      enum: ['positive', 'neutral', 'negative'],
      default: 'neutral',
      index: true
    },
    status: {
      type: String,
      enum: ['new', 'in_review', 'resolved'],
      default: 'new',
      index: true
    },
    priority: {
      type: String,
      enum: ['low', 'medium', 'urgent', 'critical'],
      default: 'medium',
      index: true
    },
    customerName: {
      type: String,
      trim: true,
      default: 'Anonymous'
    },
    customerEmail: {
      type: String,
      trim: true,
      lowercase: true,
      default: ''
    },
    customerPhone: {
      type: String,
      trim: true,
      default: ''
    },
    academicDetails: {
      type: academicDetailsSchema,
      default: null
    },
    answers: {
      type: Map,
      of: mongoose.Schema.Types.Mixed,
      default: () => new Map()
    },
    comments: {
      type: String,
      trim: true,
      default: ''
    },
    assignedTo: {
      type: String,
      trim: true,
      default: ''
    },
    resolutionNotes: {
      type: String,
      trim: true,
      default: ''
    },
    internalNotes: {
      type: [internalNoteSchema],
      default: []
    },
    source: {
      type: String,
      default: 'QR Code'
    }
  },
  {
    timestamps: true
  }
);

feedbackSchema.index({ businessId: 1, createdAt: -1 });
feedbackSchema.index({ businessId: 1, status: 1 });
feedbackSchema.index({ businessId: 1, rating: 1 });

module.exports = mongoose.models.Feedback || mongoose.model('Feedback', feedbackSchema);
