const express = require('express');
const router = express.Router();
const { comparePassword, hashPassword } = require('../utils/crypto');
const db = require('../db');
const { generateToken, requireAuth } = require('../middleware/auth');

// POST /api/auth/login
router.post('/login', (req, res) => {
  const { email, password } = req.body;
  if (!email || !password) {
    return res.status(400).json({ error: 'Email and password are required' });
  }

  const user = db.findUserByEmail(email);
  if (!user) {
    return res.status(401).json({ error: 'Invalid email or password' });
  }

  const valid = comparePassword(password, user.password);
  if (!valid) {
    return res.status(401).json({ error: 'Invalid email or password' });
  }

  const token = generateToken(user);
  const business = user.businessId ? db.getBusinessById(user.businessId) : null;

  db.logAudit('User Login', user.name, `User logged in (${user.email})`);

  return res.json({
    token,
    user: {
      id: user.id,
      name: user.name,
      email: user.email,
      role: user.role,
      avatar: user.avatar,
      businessId: user.businessId
    },
    business
  });
});

// POST /api/auth/switch-demo (Quick demo one-click login)
router.post('/switch-demo', (req, res) => {
  const { role } = req.body;
  let targetEmail = 'sarah@apexcafe.com'; // default owner

  if (role === 'superadmin') {
    targetEmail = 'admin@feedbackhub.com';
  } else if (role === 'manager') {
    targetEmail = 'marcus@apexcafe.com';
  } else if (role === 'owner') {
    targetEmail = 'sarah@apexcafe.com';
  }

  const user = db.findUserByEmail(targetEmail);
  if (!user) {
    return res.status(404).json({ error: 'Demo user not found' });
  }

  const token = generateToken(user);
  const business = user.businessId ? db.getBusinessById(user.businessId) : null;

  db.logAudit('Demo Login Switched', user.name, `Switched into ${role} role`);

  return res.json({
    token,
    user: {
      id: user.id,
      name: user.name,
      email: user.email,
      role: user.role,
      avatar: user.avatar,
      businessId: user.businessId
    },
    business
  });
});

// POST /api/auth/register
router.post('/register', (req, res) => {
  const { businessName, ownerName, email, password, category, phone } = req.body;

  if (!businessName || !ownerName || !email || !password) {
    return res.status(400).json({ error: 'Please provide all required registration fields' });
  }

  const existing = db.findUserByEmail(email);
  if (existing) {
    return res.status(400).json({ error: 'An account with this email already exists' });
  }

  // Create Business
  const newBusiness = db.createBusiness({
    name: businessName,
    category: category || 'General Business',
    phone: phone || '',
    email: email,
    logo: '🏢'
  });

  // Create Owner User
  const newUser = db.createUser({
    name: ownerName,
    email: email.toLowerCase(),
    password: hashPassword(password),
    role: 'owner',
    businessId: newBusiness.id,
    avatar: '👤'
  });

  // Create First Location
  const newLocation = db.createLocation({
    businessId: newBusiness.id,
    name: 'Main Location',
    code: 'HQ-01',
    address: '123 Business Way',
    manager: ownerName
  });

  // Create Default Feedback Form
  const slug = businessName.toLowerCase().replace(/[^a-z0-9]+/g, '-') + '-feedback';
  const newForm = db.createForm({
    businessId: newBusiness.id,
    locationId: newLocation.id,
    slug: slug + '-' + Math.random().toString(36).substring(2, 5),
    title: `${businessName} Customer Feedback`,
    description: `We appreciate your business! Please tell us about your experience so we can keep improving.`,
    status: 'published',
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
        text: 'How likely are you to recommend us to a friend or colleague?',
        required: true,
        min: 0,
        max: 10
      },
      {
        id: 'q3',
        type: 'text',
        text: 'What did you like most, or what could we do better?',
        required: false,
        multiline: true
      }
    ]
  });

  db.logAudit('New Business Registered', ownerName, `Registered ${businessName}`);

  const token = generateToken(newUser);
  return res.status(201).json({
    token,
    user: {
      id: newUser.id,
      name: newUser.name,
      email: newUser.email,
      role: newUser.role,
      avatar: newUser.avatar,
      businessId: newUser.businessId
    },
    business: newBusiness,
    firstLocation: newLocation,
    firstForm: newForm
  });
});

// GET /api/auth/me
router.get('/me', requireAuth, (req, res) => {
  const business = req.user.businessId ? db.getBusinessById(req.user.businessId) : null;
  res.json({
    user: {
      id: req.user.id,
      name: req.user.name,
      email: req.user.email,
      role: req.user.role,
      avatar: req.user.avatar,
      businessId: req.user.businessId
    },
    business
  });
});

// PUT /api/auth/business-settings (Update Business Profile)
router.put('/business-settings', requireAuth, (req, res) => {
  const { name, category, email, phone, address } = req.body;
  if (!name || !name.trim()) {
    return res.status(400).json({ error: 'Business name is required' });
  }

  const businessId = req.user.businessId;
  if (!businessId) {
    return res.status(400).json({ error: 'No business linked to your account' });
  }

  const updatedBiz = db.updateBusiness(businessId, {
    name: name.trim(),
    category: category ? category.trim() : '',
    email: email ? email.trim() : '',
    phone: phone ? phone.trim() : '',
    address: address ? address.trim() : ''
  });

  if (!updatedBiz) {
    return res.status(404).json({ error: 'Business not found' });
  }

  db.logAudit('Update Business Settings', req.user.name, `Updated business profile for ${updatedBiz.name}`);

  return res.json({
    message: 'Business settings updated successfully',
    business: updatedBiz
  });
});

module.exports = router;
