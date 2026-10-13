const express = require('express');
const router = express.Router();
const { comparePassword, hashPassword } = require('../utils/crypto');
const db = require('../db');
const { generateToken, requireAuth, requireRole } = require('../middleware/auth');

// POST /api/auth/login
router.post('/login', async (req, res) => {
  try {
    const { email, password } = req.body;
    if (!email || !password) {
      return res.status(400).json({ error: 'Email and password are required' });
    }

    const user = await db.findUserByEmail(email);
    if (!user) {
      return res.status(401).json({ error: 'Invalid email or password' });
    }

    const valid = comparePassword(password, user.password);
    if (!valid) {
      return res.status(401).json({ error: 'Invalid email or password' });
    }

    const token = generateToken(user);
    const business = user.businessId ? await db.getBusinessById(user.businessId) : null;

    await db.logAudit('User Login', user.name, `User logged in (${user.email})`, user.businessId, req.ip);

    return res.json({
      token,
      user: {
        id: user._id || user.id,
        name: user.name,
        email: user.email,
        role: user.role,
        avatar: user.avatar,
        businessId: user.businessId
      },
      business
    });
  } catch (err) {
    if (err.statusCode === 503) {
      return res.status(503).json({ error: err.message });
    }
    console.error('[Login Error]:', err);
    return res.status(500).json({ error: 'Failed to process login request' });
  }
});

// POST /api/auth/switch-demo (Developer / Demo Fast Switcher)
router.post('/switch-demo', async (req, res) => {
  const isDemoEnabled = process.env.ENABLE_DEMO_MODE === 'true' && process.env.NODE_ENV !== 'production';

  if (!isDemoEnabled) {
    return res.status(403).json({
      error: 'Demo switching is disabled in production environments. Please sign in with registered credentials.'
    });
  }

  const { role } = req.body;

  // STRICT SECURITY REQUIREMENT: Never allow public requests to obtain a super-admin token
  if (role === 'superadmin') {
    return res.status(403).json({
      error: 'Super-admin access cannot be acquired through demo switching. Please authenticate using the super-admin credentials on the login page.'
    });
  }

  let targetEmail = 'sarah@apexcafe.com'; // default owner
  if (role === 'manager') {
    targetEmail = 'marcus@apexcafe.com';
  } else if (role === 'college' || role === 'owner_college') {
    targetEmail = 'sarah@apexinstitute.edu.in';
  } else if (role === 'college_admin') {
    targetEmail = 'dean@apexinstitute.edu.in';
  } else if (role === 'staff') {
    targetEmail = 'staff@apexinstitute.edu.in';
  }

  try {
    const user = await db.findUserByEmail(targetEmail);
    if (!user) {
      return res.status(404).json({
        error: `Demo user for role "${role}" not found. Ensure the development seed script has been run.`
      });
    }

    const token = generateToken(user);
    const business = user.businessId ? await db.getBusinessById(user.businessId) : null;

    await db.logAudit('Demo Role Switched', user.name, `Dev demo switched to ${role}`, user.businessId, req.ip);

    return res.json({
      token,
      user: {
        id: user._id || user.id,
        name: user.name,
        email: user.email,
        role: user.role,
        avatar: user.avatar,
        businessId: user.businessId
      },
      business
    });
  } catch (err) {
    if (err.statusCode === 503) {
      return res.status(503).json({ error: err.message });
    }
    console.error('[Demo Switch Error]:', err);
    return res.status(500).json({ error: 'Failed to switch demo account' });
  }
});

// POST /api/auth/register
router.post('/register', async (req, res) => {
  try {
    const {
      businessName,
      businessType,
      ownerName,
      email,
      password,
      category,
      phone,
      isOnlineOnly,
      address
    } = req.body;

    // Validate required fields
    if (!businessName || !businessName.trim()) {
      return res.status(400).json({ error: 'Business name is required' });
    }
    if (!ownerName || !ownerName.trim()) {
      return res.status(400).json({ error: 'Owner name is required' });
    }
    if (!email || !email.trim()) {
      return res.status(400).json({ error: 'Email address is required' });
    }
    if (!password || password.length < 6) {
      return res.status(400).json({ error: 'Password must be at least 6 characters long' });
    }

    const normalizedEmail = email.toLowerCase().trim();

    // Validate physical address for physical businesses
    const onlineOnly = Boolean(isOnlineOnly);
    let validatedAddress = {
      addressLine1: '',
      addressLine2: '',
      city: '',
      state: '',
      postalCode: '',
      country: 'India'
    };

    if (!onlineOnly) {
      if (!address || !address.addressLine1 || !address.addressLine1.trim()) {
        return res.status(400).json({ error: 'Physical address line 1 is required for physical businesses' });
      }
      if (!address.city || !address.city.trim()) {
        return res.status(400).json({ error: 'City is required for physical businesses' });
      }
      if (!address.state || !address.state.trim()) {
        return res.status(400).json({ error: 'State is required for physical businesses' });
      }
      if (!address.postalCode || !address.postalCode.trim()) {
        return res.status(400).json({ error: 'Postal/PIN code is required for physical businesses' });
      }

      validatedAddress = {
        addressLine1: address.addressLine1.trim(),
        addressLine2: address.addressLine2 ? address.addressLine2.trim() : '',
        city: address.city.trim(),
        state: address.state.trim(),
        postalCode: address.postalCode.trim(),
        country: address.country ? address.country.trim() : 'India'
      };
    }

    const existing = await db.findUserByEmail(normalizedEmail);
    if (existing) {
      return res.status(400).json({ error: 'An account with this email address already exists' });
    }

    // Determine type and logo
    const validTypes = ['college', 'coaching', 'restaurant', 'healthcare', 'salon', 'other'];
    const bType = validTypes.includes(businessType) ? businessType : 'other';

    const logos = {
      college: '🎓',
      coaching: '📚',
      restaurant: '☕',
      healthcare: '🏥',
      salon: '✂️',
      other: '🏢'
    };

    // 1. Create Business
    const newBusiness = await db.createBusiness({
      name: businessName.trim(),
      type: bType,
      category: category ? category.trim() : (bType === 'college' ? 'College / University' : 'General Business'),
      email: normalizedEmail,
      phone: phone ? phone.trim() : '',
      address: validatedAddress,
      isOnlineOnly: onlineOnly,
      logo: logos[bType] || '🏢',
      active: true
    });

    // 2. Create Owner User
    const newUser = await db.createUser({
      name: ownerName.trim(),
      email: normalizedEmail,
      password: hashPassword(password),
      role: 'owner',
      businessId: newBusiness._id,
      avatar: bType === 'college' ? '👩‍🏫' : '👤'
    });

    // 3. Create Primary Location using real address
    const locationAddress = onlineOnly
      ? 'Online / Digital Headquarters'
      : `${validatedAddress.addressLine1}, ${validatedAddress.city}, ${validatedAddress.state} - ${validatedAddress.postalCode}`;

    const newLocation = await db.createLocation({
      businessId: newBusiness._id,
      name: bType === 'college' ? 'Main Campus' : 'Primary Location',
      code: 'HQ-01',
      address: locationAddress,
      phone: phone ? phone.trim() : '',
      manager: ownerName.trim()
    });

    // 4. Create Default Form based on business type
    const slugBase = businessName.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '') || 'feedback';
    const formSlug = `${slugBase}-${Math.random().toString(36).substring(2, 6)}`;

    let defaultQuestions = [];
    let collegeFieldsConfig = {};

    if (bType === 'college') {
      collegeFieldsConfig = {
        departmentEnabled: true,
        departmentRequired: true,
        courseEnabled: true,
        courseRequired: true,
        academicYearEnabled: true,
        academicYearRequired: true,
        yearOfStudyEnabled: true,
        yearOfStudyRequired: true,
        semesterEnabled: true,
        semesterRequired: true,
        sectionEnabled: true,
        sectionRequired: false,
        facultyEnabled: true,
        facultyRequired: true,
        subjectEnabled: true,
        subjectRequired: true,
        categoryEnabled: true,
        categoryRequired: true
      };

      defaultQuestions = [
        {
          id: 'q_academic_clarity',
          type: 'rating',
          text: 'Clarity of concepts explained and classroom preparation by faculty:',
          required: true,
          min: 1,
          max: 5,
          order: 1
        },
        {
          id: 'q_syllabus_coverage',
          type: 'rating',
          text: 'Pace of syllabus coverage and timely completion of academic units:',
          required: true,
          min: 1,
          max: 5,
          order: 2
        },
        {
          id: 'q_doubt_solving',
          type: 'choice',
          text: 'Are doubts and student queries addressed constructively during or after class?',
          options: ['Always addressed thoroughly', 'Addressed mostly', 'Occasionally addressed', 'Rarely or never'],
          required: true,
          order: 3
        },
        {
          id: 'q_college_nps',
          type: 'nps',
          text: 'How likely are you to recommend this institution to prospective students? (0-10)',
          required: true,
          min: 0,
          max: 10,
          order: 4
        },
        {
          id: 'q_college_comments',
          type: 'multiline',
          text: 'Suggestions for labs, infrastructure, library resources, or teaching improvements:',
          required: false,
          placeholder: 'Share your honest feedback...',
          order: 5
        }
      ];
    } else {
      defaultQuestions = [
        {
          id: 'q_rating',
          type: 'rating',
          text: 'How would you rate your overall experience today?',
          required: true,
          min: 1,
          max: 5,
          order: 1
        },
        {
          id: 'q_nps',
          type: 'nps',
          text: 'How likely are you to recommend us to a friend or colleague? (0-10)',
          required: true,
          min: 0,
          max: 10,
          order: 2
        },
        {
          id: 'q_feedback',
          type: 'multiline',
          text: 'What did you love most or how can we improve?',
          required: false,
          placeholder: 'Tell us about your experience...',
          order: 3
        }
      ];
    }

    const newForm = await db.createForm({
      businessId: newBusiness._id,
      locationId: newLocation._id,
      slug: formSlug,
      title: `${businessName.trim()} Feedback`,
      description: bType === 'college'
        ? 'We value student feedback to foster academic excellence. Responses are reviewed for curriculum and campus improvements.'
        : 'Thank you for visiting! Your feedback helps us deliver an outstanding experience.',
      formType: bType === 'college' ? 'college' : 'general',
      status: 'published',
      allowAnonymous: true,
      collegeFieldsConfig,
      questions: defaultQuestions
    });

    await db.logAudit(
      'Business Registered',
      ownerName.trim(),
      `Registered ${businessName} (${bType}) with initial location and form`,
      newBusiness._id,
      req.ip
    );

    const token = generateToken(newUser);
    return res.status(201).json({
      token,
      user: {
        id: newUser._id || newUser.id,
        name: newUser.name,
        email: newUser.email,
        role: newUser.role,
        avatar: newUser.avatar,
        businessId: newBusiness._id
      },
      business: newBusiness,
      firstLocation: newLocation,
      firstForm: newForm
    });
  } catch (err) {
    if (err.statusCode === 503) {
      return res.status(503).json({ error: err.message });
    }
    console.error('[Registration Error]:', err);
    return res.status(500).json({ error: 'Registration failed due to a server error' });
  }
});

// GET /api/auth/me
router.get('/me', requireAuth, async (req, res) => {
  try {
    const business = req.user.businessId ? await db.getBusinessById(req.user.businessId) : null;
    return res.json({
      user: {
        id: req.user._id || req.user.id,
        name: req.user.name,
        email: req.user.email,
        role: req.user.role,
        avatar: req.user.avatar,
        businessId: req.user.businessId
      },
      business
    });
  } catch (err) {
    console.error('[Auth Me Error]:', err);
    return res.status(500).json({ error: 'Failed to fetch current user session' });
  }
});

// PUT /api/auth/business-settings (Update Business Profile & Academic Config)
router.put('/business-settings', requireAuth, requireRole('owner', 'college_admin', 'superadmin'), async (req, res) => {
  try {
    const { name, category, email, phone, address, isOnlineOnly, googleReviewUrl, academicConfig } = req.body;

    if (!name || !name.trim()) {
      return res.status(400).json({ error: 'Business name is required' });
    }

    const businessId = req.user.businessId;
    if (!businessId) {
      return res.status(400).json({ error: 'No business linked to your account' });
    }

    const updates = {
      name: name.trim(),
      category: category ? category.trim() : '',
      email: email ? email.trim() : '',
      phone: phone ? phone.trim() : ''
    };

    if (googleReviewUrl !== undefined) {
      updates.googleReviewUrl = googleReviewUrl.trim();
    }

    if (isOnlineOnly !== undefined) {
      updates.isOnlineOnly = Boolean(isOnlineOnly);
    }

    if (address && typeof address === 'object') {
      updates.address = {
        addressLine1: address.addressLine1 ? address.addressLine1.trim() : '',
        addressLine2: address.addressLine2 ? address.addressLine2.trim() : '',
        city: address.city ? address.city.trim() : '',
        state: address.state ? address.state.trim() : '',
        postalCode: address.postalCode ? address.postalCode.trim() : '',
        country: address.country ? address.country.trim() : 'India'
      };
    }

    if (academicConfig && typeof academicConfig === 'object') {
      updates.academicConfig = academicConfig;
    }

    const updatedBiz = await db.updateBusiness(businessId, updates);
    if (!updatedBiz) {
      return res.status(404).json({ error: 'Business not found' });
    }

    await db.logAudit('Update Business Settings', req.user.name, `Updated settings for ${updatedBiz.name}`, businessId, req.ip);

    return res.json({
      message: 'Business settings updated successfully',
      business: updatedBiz
    });
  } catch (err) {
    if (err.statusCode === 503) {
      return res.status(503).json({ error: err.message });
    }
    console.error('[Update Settings Error]:', err);
    return res.status(500).json({ error: 'Failed to update business settings' });
  }
});

module.exports = router;
