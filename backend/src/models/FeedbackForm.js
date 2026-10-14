const mongoose = require('mongoose');

const conditionalSchema = new mongoose.Schema(
  {
    dependsOn: { type: String, trim: true },
    operator: {
      type: String,
      enum: ['equals', 'not_equals', 'in', 'greater_than', 'less_than', 'contains'],
      default: 'equals'
    },
    value: { type: mongoose.Schema.Types.Mixed }
  },
  { _id: false }
);

const questionSchema = new mongoose.Schema(
  {
    id: { type: String, required: true, trim: true },
    type: {
      type: String,
      required: true,
      enum: [
        'rating',
        'nps',
        'text',
        'multiline',
        'choice',
        'select',
        'checkbox',
        'yesno',
        'email',
        'phone',
        'number',
        'date'
      ]
    },
    text: { type: String, required: true, trim: true },
    description: { type: String, trim: true, default: '' },
    placeholder: { type: String, trim: true, default: '' },
    required: { type: Boolean, default: false },
    min: { type: Number, default: 1 },
    max: { type: Number, default: 5 },
    options: { type: [String], default: [] },
    multiline: { type: Boolean, default: false },
    order: { type: Number, default: 0 },
    conditional: { type: conditionalSchema, default: null }
  },
  { _id: false }
);

const collegeFieldsConfigSchema = new mongoose.Schema(
  {
    departmentEnabled: { type: Boolean, default: false },
    departmentRequired: { type: Boolean, default: false },
    courseEnabled: { type: Boolean, default: false },
    courseRequired: { type: Boolean, default: false },
    academicYearEnabled: { type: Boolean, default: false },
    academicYearRequired: { type: Boolean, default: false },
    yearOfStudyEnabled: { type: Boolean, default: false },
    yearOfStudyRequired: { type: Boolean, default: false },
    semesterEnabled: { type: Boolean, default: false },
    semesterRequired: { type: Boolean, default: false },
    sectionEnabled: { type: Boolean, default: false },
    sectionRequired: { type: Boolean, default: false },
    facultyEnabled: { type: Boolean, default: false },
    facultyRequired: { type: Boolean, default: false },
    subjectEnabled: { type: Boolean, default: false },
    subjectRequired: { type: Boolean, default: false },
    categoryEnabled: { type: Boolean, default: false },
    categoryRequired: { type: Boolean, default: false }
  },
  { _id: false }
);

const feedbackFormSchema = new mongoose.Schema(
  {
    businessId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'Business',
      required: [true, 'Business ID is required'],
      index: true
    },
    locationId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'Location',
      default: null,
      index: true
    },
    slug: {
      type: String,
      required: [true, 'Form slug is required'],
      unique: true,
      lowercase: true,
      trim: true,
      index: true
    },
    title: {
      type: String,
      required: [true, 'Form title is required'],
      trim: true
    },
    description: {
      type: String,
      trim: true,
      default: ''
    },
    formType: {
      type: String,
      enum: ['general', 'college', 'faculty', 'facilities', 'restaurant', 'coaching'],
      default: 'general',
      index: true
    },
    status: {
      type: String,
      enum: ['draft', 'published', 'paused', 'archived'],
      default: 'draft',
      index: true
    },
    allowAnonymous: {
      type: Boolean,
      default: true
    },
    showOverallRating: {
      type: Boolean,
      default: true
    },
    requireOverallRating: {
      type: Boolean,
      default: true
    },
    googleReviewUrl: {
      type: String,
      trim: true,
      default: ''
    },
    collegeFieldsConfig: {
      type: collegeFieldsConfigSchema,
      default: () => ({})
    },
    questions: {
      type: [questionSchema],
      default: []
    }
  },
  {
    timestamps: true
  }
);

feedbackFormSchema.index({ businessId: 1, status: 1 });

module.exports = mongoose.models.FeedbackForm || mongoose.model('FeedbackForm', feedbackFormSchema);
