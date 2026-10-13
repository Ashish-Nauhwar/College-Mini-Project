const mongoose = require('mongoose');

const addressSchema = new mongoose.Schema(
  {
    addressLine1: { type: String, trim: true },
    addressLine2: { type: String, trim: true },
    city: { type: String, trim: true },
    state: { type: String, trim: true },
    postalCode: { type: String, trim: true },
    country: { type: String, default: 'India', trim: true }
  },
  { _id: false }
);

const facultySchema = new mongoose.Schema(
  {
    name: { type: String, required: true, trim: true },
    department: { type: String, trim: true },
    email: { type: String, trim: true, lowercase: true }
  },
  { _id: false }
);

const subjectSchema = new mongoose.Schema(
  {
    name: { type: String, required: true, trim: true },
    code: { type: String, trim: true },
    department: { type: String, trim: true }
  },
  { _id: false }
);

const academicConfigSchema = new mongoose.Schema(
  {
    departments: { type: [String], default: [] },
    courses: { type: [String], default: [] },
    years: { type: [String], default: [] },
    semesters: { type: [String], default: [] },
    sections: { type: [String], default: [] },
    faculty: { type: [facultySchema], default: [] },
    subjects: { type: [subjectSchema], default: [] }
  },
  { _id: false }
);

const businessSchema = new mongoose.Schema(
  {
    name: {
      type: String,
      required: [true, 'Business name is required'],
      trim: true
    },
    type: {
      type: String,
      enum: ['college', 'coaching', 'restaurant', 'healthcare', 'salon', 'other'],
      default: 'other',
      index: true
    },
    category: {
      type: String,
      trim: true,
      default: 'General Business'
    },
    email: {
      type: String,
      trim: true,
      lowercase: true
    },
    phone: {
      type: String,
      trim: true
    },
    address: {
      type: addressSchema,
      default: () => ({ country: 'India' })
    },
    isOnlineOnly: {
      type: Boolean,
      default: false
    },
    logo: {
      type: String,
      default: '🏢'
    },
    googleReviewUrl: {
      type: String,
      trim: true,
      default: ''
    },
    active: {
      type: Boolean,
      default: true,
      index: true
    },
    academicConfig: {
      type: academicConfigSchema,
      default: () => ({
        departments: ['Computer Science (CSE)', 'Electronics (ECE)', 'Mechanical (MECH)', 'Civil Engineering', 'Information Technology'],
        courses: ['B.Tech / B.E.', 'M.Tech', 'BCA', 'MCA', 'B.Sc / M.Sc', 'MBA'],
        years: ['1st Year', '2nd Year', '3rd Year', '4th Year'],
        semesters: ['Semester 1', 'Semester 2', 'Semester 3', 'Semester 4', 'Semester 5', 'Semester 6', 'Semester 7', 'Semester 8'],
        sections: ['Section A', 'Section B', 'Section C'],
        faculty: [],
        subjects: []
      })
    }
  },
  {
    timestamps: true
  }
);

module.exports = mongoose.models.Business || mongoose.model('Business', businessSchema);
