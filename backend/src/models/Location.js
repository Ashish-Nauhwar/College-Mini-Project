const mongoose = require('mongoose');

const locationSchema = new mongoose.Schema(
  {
    businessId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'Business',
      required: [true, 'Business ID is required'],
      index: true
    },
    name: {
      type: String,
      required: [true, 'Location name is required'],
      trim: true
    },
    code: {
      type: String,
      trim: true,
      default: ''
    },
    address: {
      type: String,
      required: [true, 'Address is required'],
      trim: true
    },
    phone: {
      type: String,
      trim: true,
      default: ''
    },
    manager: {
      type: String,
      trim: true,
      default: ''
    },
    active: {
      type: Boolean,
      default: true,
      index: true
    }
  },
  {
    timestamps: true
  }
);

locationSchema.index({ businessId: 1, name: 1 });

module.exports = mongoose.models.Location || mongoose.model('Location', locationSchema);
