// FeedbackHub Public Customer & Student Feedback Form Client
// 100% Dynamic, Non-Gated Reviews, College Academic Support, and Real-Time Conditional Logic

(function () {
  'use strict';

  let currentForm = null;
  let currentBusiness = null;
  let selectedRating = 0;
  const dynamicAnswers = {};
  const academicDetails = {};

  const ratingDescriptions = {
    1: '1 Star - Poor Experience',
    2: '2 Stars - Needs Improvement',
    3: '3 Stars - Average / Satisfactory',
    4: '4 Stars - Very Good Experience',
    5: '5 Stars - Absolutely Excellent!'
  };

  function getSlugFromUrl() {
    const path = window.location.pathname;
    const parts = path.split('/').filter(Boolean);
    if (parts.length >= 2 && parts[0] === 'feedback') {
      return parts[1];
    }
    const params = new URLSearchParams(window.location.search);
    return params.get('slug') || 'apex-downtown';
  }

  async function loadForm() {
    const slug = getSlugFromUrl();
    const loadingEl = document.getElementById('loadingIndicator');
    const errorEl = document.getElementById('errorState');
    const formEl = document.getElementById('publicFeedbackForm');

    try {
      const res = await fetch(`/api/forms/slug/${encodeURIComponent(slug)}`);
      if (!res.ok) {
        const errData = await res.json().catch(() => ({}));
        throw new Error(errData.error || 'Feedback form not found or inactive');
      }

      const data = await res.json();
      currentForm = data.form;
      currentBusiness = data.business;

      // Populate branding
      if (data.business) {
        document.getElementById('bizLogo').textContent = data.business.logo || '🏢';
        document.getElementById('bizName').textContent = data.business.name;
        document.title = `${data.business.name} - Feedback`;
      }
      if (data.location) {
        document.getElementById('locName').textContent = `${data.location.name} • ${data.location.address}`;
      } else {
        document.getElementById('locName').textContent = 'We value your honest feedback';
      }

      if (currentForm.description) {
        document.getElementById('formDescription').textContent = currentForm.description;
      }

      // Render college academic context if enabled
      renderCollegeFields(currentForm.collegeFieldsConfig, data.business?.academicConfig);

      // Render all dynamic questions
      renderDynamicQuestions(currentForm.questions || []);

      loadingEl.classList.add('hidden');
      formEl.classList.remove('hidden');
      initStarSelector();
      evaluateAllConditions();
    } catch (err) {
      loadingEl.classList.add('hidden');
      errorEl.classList.remove('hidden');
      document.getElementById('errorMessage').textContent = err.message || 'Unable to load feedback form.';
    }
  }

  function renderCollegeFields(config, academicConfig) {
    const section = document.getElementById('collegeFieldsSection');
    const grid = document.getElementById('collegeFieldsGrid');
    if (!section || !grid || !config) return;

    // Academic options derived strictly from institution's academicConfig - no hardcoded fallbacks
    const fields = [
      { key: 'department', label: 'Department / Branch', enabled: config.departmentEnabled, required: config.departmentRequired, options: academicConfig?.departments || [] },
      { key: 'course', label: 'Course / Program', enabled: config.courseEnabled, required: config.courseRequired, options: academicConfig?.courses || [] },
      { key: 'academicYear', label: 'Academic Year', enabled: config.academicYearEnabled, required: config.academicYearRequired, options: academicConfig?.academicYears || [] },
      { key: 'yearOfStudy', label: 'Year of Study', enabled: config.yearOfStudyEnabled, required: config.yearOfStudyRequired, options: academicConfig?.years || [] },
      { key: 'semester', label: 'Semester', enabled: config.semesterEnabled, required: config.semesterRequired, options: academicConfig?.semesters || [] },
      { key: 'section', label: 'Class / Section', enabled: config.sectionEnabled, required: config.sectionRequired, options: academicConfig?.sections || [] },
      { key: 'faculty', label: 'Faculty Member', enabled: config.facultyEnabled, required: config.facultyRequired, options: (academicConfig?.faculty || []).map(f => typeof f === 'object' ? { value: f.name, label: f.name } : { value: f, label: f }) },
      { key: 'subject', label: 'Subject / Course Unit', enabled: config.subjectEnabled, required: config.subjectRequired, options: (academicConfig?.subjects || []).map(s => typeof s === 'object' ? { value: s.name, label: `${s.name}${s.code ? ` (${s.code})` : ''}` } : { value: s, label: s }) },
      { key: 'category', label: 'Feedback Category', enabled: config.categoryEnabled, required: config.categoryRequired, options: academicConfig?.feedbackCategories || [] }
    ];

    const activeFields = fields.filter(f => f.enabled);
    if (activeFields.length === 0) {
      section.classList.add('hidden');
      return;
    }

    section.classList.remove('hidden');
    grid.innerHTML = activeFields.map(f => `
      <div class="form-group" style="margin-bottom: 0;">
        <label class="form-label" for="acad_${f.key}">
          ${f.label} ${f.required ? '<span class="required">*</span>' : ''}
        </label>
        <select id="acad_${f.key}" class="form-select" onchange="window.updateAcademicField('${f.key}', this.value)">
          <option value="">-- Select ${f.label} --</option>
          ${f.options.map(opt => {
            const val = typeof opt === 'object' ? opt.value : opt;
            const lbl = typeof opt === 'object' ? opt.label : opt;
            return `<option value="${escapeHtml(val)}">${escapeHtml(lbl)}</option>`;
          }).join('')}
        </select>
        <div id="error_acad_${f.key}" class="form-error hidden">Please select ${f.label.toLowerCase()}</div>
      </div>
    `).join('');
  }

  window.updateAcademicField = function (key, value) {
    academicDetails[key] = value;
    const err = document.getElementById(`error_acad_${key}`);
    if (err) err.classList.add('hidden');

    // Filter faculty and subjects if department changed
    if (key === 'department' && currentBusiness?.academicConfig) {
      const selectedDept = value;
      const facultySelect = document.getElementById('acad_faculty');
      const subjectSelect = document.getElementById('acad_subject');

      if (facultySelect && currentBusiness.academicConfig.faculty) {
        const filteredFac = currentBusiness.academicConfig.faculty.filter(f => !selectedDept || !f.department || f.department === selectedDept);
        facultySelect.innerHTML = '<option value="">-- Select Faculty Member --</option>' +
          filteredFac.map(f => {
            const facName = typeof f === 'object' ? f.name : f;
            return `<option value="${escapeHtml(facName)}">${escapeHtml(facName)}</option>`;
          }).join('');

        // Reset stale selection if previously selected faculty is no longer in filtered list
        const stillValidFac = filteredFac.some(f => (typeof f === 'object' ? f.name : f) === academicDetails.faculty);
        if (!stillValidFac) {
          academicDetails.faculty = '';
          facultySelect.value = '';
        } else {
          facultySelect.value = academicDetails.faculty;
        }
      }

      if (subjectSelect && currentBusiness.academicConfig.subjects) {
        const filteredSub = currentBusiness.academicConfig.subjects.filter(s => !selectedDept || !s.department || s.department === selectedDept);
        subjectSelect.innerHTML = '<option value="">-- Select Subject / Course Unit --</option>' +
          filteredSub.map(s => {
            const sName = typeof s === 'object' ? s.name : s;
            const sLabel = typeof s === 'object' && s.code ? `${s.name} (${s.code})` : sName;
            return `<option value="${escapeHtml(sName)}">${escapeHtml(sLabel)}</option>`;
          }).join('');

        // Reset stale selection if previously selected subject is no longer in filtered list
        const stillValidSub = filteredSub.some(s => (typeof s === 'object' ? s.name : s) === academicDetails.subject);
        if (!stillValidSub) {
          academicDetails.subject = '';
          subjectSelect.value = '';
        } else {
          subjectSelect.value = academicDetails.subject;
        }
      }
    }
  };

  function initStarSelector() {
    const buttons = document.querySelectorAll('.star-rating-btn');
    const helperText = document.getElementById('ratingHelperText');

    buttons.forEach((btn, index) => {
      const val = index + 1;

      btn.addEventListener('click', () => {
        selectedRating = val;
        updateStarsDisplay(val);
        helperText.textContent = ratingDescriptions[val] || `${val} Stars`;
        helperText.style.color = 'var(--primary)';
        document.getElementById('ratingError').classList.add('hidden');
        evaluateAllConditions();
      });

      btn.addEventListener('mouseenter', () => {
        updateStarsDisplay(val, true);
      });

      btn.addEventListener('mouseleave', () => {
        updateStarsDisplay(selectedRating, false);
      });

      btn.addEventListener('keydown', (e) => {
        if (e.key === 'ArrowRight' && index < buttons.length - 1) {
          buttons[index + 1].focus();
        } else if (e.key === 'ArrowLeft' && index > 0) {
          buttons[index - 1].focus();
        }
      });
    });
  }

  function updateStarsDisplay(rating, isHover = false) {
    const buttons = document.querySelectorAll('.star-rating-btn');
    buttons.forEach((btn, index) => {
      const starVal = index + 1;
      if (starVal <= rating) {
        btn.classList.add('active');
        btn.style.color = '#f59e0b';
        btn.style.transform = isHover ? 'scale(1.15)' : 'scale(1.05)';
      } else {
        btn.classList.remove('active');
        btn.style.color = '#cbd5e1';
        btn.style.transform = 'scale(1)';
      }
    });
  }

  function renderDynamicQuestions(questions) {
    const container = document.getElementById('dynamicQuestionsContainer');
    if (!container) return;

    container.innerHTML = questions.map((q, idx) => {
      return `
        <div class="form-group question-group" id="qwrap_${q.id}" data-qid="${q.id}">
          <label class="form-label" for="inp_${q.id}">
            ${idx + 1}. ${escapeHtml(q.text)} ${q.required ? '<span class="required">*</span>' : ''}
          </label>
          ${q.description ? `<p class="text-muted text-sm" style="margin-top: -4px; margin-bottom: 6px;">${escapeHtml(q.description)}</p>` : ''}
          <div class="question-control-wrapper">
            ${renderQuestionControl(q)}
          </div>
          <div id="error_${q.id}" class="form-error hidden">This question is required</div>
        </div>
      `;
    }).join('');
  }

  function renderQuestionControl(q) {
    switch (q.type) {
      case 'rating': {
        const max = q.max || 5;
        const pills = [];
        for (let i = 1; i <= max; i++) {
          pills.push(`
            <button type="button" class="btn btn-secondary btn-sm q-rating-pill" data-qid="${q.id}" data-val="${i}" onclick="window.setDynamicAnswer('${q.id}', ${i}, this)" style="min-width: 44px; min-height: 44px; font-weight: 700;">
              ${i} ★
            </button>
          `);
        }
        return `<div style="display: flex; gap: 8px; flex-wrap: wrap;">${pills.join('')}</div>`;
      }
      case 'nps': {
        const buttons = [];
        for (let i = 0; i <= 10; i++) {
          buttons.push(`
            <button type="button" class="nps-btn" data-qid="${q.id}" data-val="${i}" onclick="window.setDynamicAnswer('${q.id}', ${i}, this)" style="min-width: 44px; min-height: 44px;">
              ${i}
            </button>
          `);
        }
        return `
          <div class="nps-scale-wrapper" style="display: flex; gap: 6px; overflow-x: auto; padding-bottom: 6px;">
            ${buttons.join('')}
          </div>
          <div style="display: flex; justify-content: space-between; font-size: 0.75rem; color: var(--neutral-500); margin-top: 4px;">
            <span>0 = Not Likely</span>
            <span>10 = Extremely Likely</span>
          </div>
        `;
      }
      case 'choice': {
        const options = q.options || [];
        return `
          <div class="choice-chips-container" style="display: flex; flex-direction: column; gap: 8px;">
            ${options.map((opt, optIdx) => `
              <label class="choice-chip-card" style="display: flex; align-items: center; gap: 10px; padding: 12px 14px; background: #ffffff; border: 1.5px solid var(--neutral-200); border-radius: var(--radius-md); cursor: pointer; min-height: 44px;">
                <input type="radio" name="radio_${q.id}" value="${escapeHtml(opt)}" onchange="window.setDynamicAnswer('${q.id}', this.value)" style="width: 18px; height: 18px;">
                <span style="font-size: 0.95rem;">${escapeHtml(opt)}</span>
              </label>
            `).join('')}
          </div>
        `;
      }
      case 'select': {
        const options = q.options || [];
        return `
          <select id="inp_${q.id}" class="form-select" onchange="window.setDynamicAnswer('${q.id}', this.value)">
            <option value="">-- Please select an option --</option>
            ${options.map(opt => `<option value="${escapeHtml(opt)}">${escapeHtml(opt)}</option>`).join('')}
          </select>
        `;
      }
      case 'checkbox': {
        const options = q.options || [];
        return `
          <div style="display: flex; flex-direction: column; gap: 8px;">
            ${options.map(opt => `
              <label style="display: flex; align-items: center; gap: 10px; padding: 10px 12px; background: #ffffff; border: 1px solid var(--neutral-200); border-radius: var(--radius-md); cursor: pointer; min-height: 44px;">
                <input type="checkbox" data-qid="${q.id}" value="${escapeHtml(opt)}" onchange="window.toggleCheckboxAnswer('${q.id}', this.value, this.checked)" style="width: 18px; height: 18px;">
                <span style="font-size: 0.95rem;">${escapeHtml(opt)}</span>
              </label>
            `).join('')}
          </div>
        `;
      }
      case 'yesno': {
        return `
          <div style="display: flex; gap: 12px;">
            <button type="button" class="btn btn-secondary q-yesno-btn" data-qid="${q.id}" data-val="Yes" onclick="window.setDynamicAnswer('${q.id}', 'Yes', this)" style="flex: 1; min-height: 46px; font-weight: 600;">
              👍 Yes
            </button>
            <button type="button" class="btn btn-secondary q-yesno-btn" data-qid="${q.id}" data-val="No" onclick="window.setDynamicAnswer('${q.id}', 'No', this)" style="flex: 1; min-height: 46px; font-weight: 600;">
              👎 No
            </button>
          </div>
        `;
      }
      case 'number': {
        return `
          <input type="number" id="inp_${q.id}" class="form-input" placeholder="e.g. 42" oninput="window.setDynamicAnswer('${q.id}', Number(this.value))">
        `;
      }
      case 'date': {
        return `
          <input type="date" id="inp_${q.id}" class="form-input" onchange="window.setDynamicAnswer('${q.id}', this.value)">
        `;
      }
      case 'email': {
        return `
          <input type="email" id="inp_${q.id}" class="form-input" placeholder="student@example.com" oninput="window.setDynamicAnswer('${q.id}', this.value.trim())">
        `;
      }
      case 'phone': {
        return `
          <input type="tel" id="inp_${q.id}" class="form-input" placeholder="+91 98765 43210" oninput="window.setDynamicAnswer('${q.id}', this.value.trim())">
        `;
      }
      case 'multiline': {
        return `
          <textarea id="inp_${q.id}" class="form-textarea" rows="3" placeholder="${escapeHtml(q.placeholder || 'Type your comments here...')}" oninput="window.setDynamicAnswer('${q.id}', this.value.trim())"></textarea>
        `;
      }
      case 'text':
      default: {
        return `
          <input type="text" id="inp_${q.id}" class="form-input" placeholder="${escapeHtml(q.placeholder || 'Your response...')}" oninput="window.setDynamicAnswer('${q.id}', this.value.trim())">
        `;
      }
    }
  }

  window.setDynamicAnswer = function (qid, value, btnEl) {
    dynamicAnswers[qid] = value;
    clearFieldError(qid);

    if (btnEl) {
      const siblings = btnEl.parentElement.querySelectorAll(`[data-qid="${qid}"]`);
      siblings.forEach(s => {
        s.classList.remove('btn-primary', 'active');
        s.classList.add('btn-secondary');
      });
      btnEl.classList.remove('btn-secondary');
      btnEl.classList.add('btn-primary', 'active');
    }

    evaluateAllConditions();
  };

  window.toggleCheckboxAnswer = function (qid, value, isChecked) {
    if (!Array.isArray(dynamicAnswers[qid])) {
      dynamicAnswers[qid] = [];
    }
    if (isChecked) {
      if (!dynamicAnswers[qid].includes(value)) dynamicAnswers[qid].push(value);
    } else {
      dynamicAnswers[qid] = dynamicAnswers[qid].filter(v => v !== value);
    }
    clearFieldError(qid);
    evaluateAllConditions();
  };

  function evaluateAllConditions() {
    if (!currentForm || !currentForm.questions) return;

    currentForm.questions.forEach(q => {
      const wrap = document.getElementById(`qwrap_${q.id}`);
      if (!wrap) return;

      if (!q.conditional || !q.conditional.dependsOn) {
        wrap.classList.remove('hidden');
        return;
      }

      const parentVal = dynamicAnswers[q.conditional.dependsOn];
      const target = q.conditional.value;
      const op = q.conditional.operator || 'equals';
      let satisfied = false;

      if (parentVal !== undefined && parentVal !== null) {
        if (op === 'equals') satisfied = String(parentVal).trim() === String(target).trim();
        else if (op === 'not_equals') satisfied = String(parentVal).trim() !== String(target).trim();
        else if (op === 'in' && Array.isArray(target)) satisfied = target.some(t => String(t).trim() === String(parentVal).trim());
        else if (op === 'greater_than') satisfied = Number(parentVal) > Number(target);
        else if (op === 'less_than') satisfied = Number(parentVal) < Number(target);
        else if (op === 'contains') {
          if (Array.isArray(parentVal)) {
            satisfied = parentVal.some(t => String(t).toLowerCase().includes(String(target).toLowerCase()));
          } else {
            satisfied = String(parentVal).toLowerCase().includes(String(target).toLowerCase());
          }
        }
      }

      if (satisfied) {
        wrap.classList.remove('hidden');
      } else {
        wrap.classList.add('hidden');
        delete dynamicAnswers[q.id];
      }
    });
  }

  function clearFieldError(fieldId) {
    const err = document.getElementById(`error_${fieldId}`);
    if (err) err.classList.add('hidden');
  }

  // Handle Form Submission
  const formEl = document.getElementById('publicFeedbackForm');
  formEl.addEventListener('submit', async (e) => {
    e.preventDefault();

    let hasErrors = false;

    // Validate Star Rating
    if (!selectedRating) {
      document.getElementById('ratingError').classList.remove('hidden');
      hasErrors = true;
    } else {
      document.getElementById('ratingError').classList.add('hidden');
    }

    // Validate College Fields if required
    const cfConfig = currentForm?.collegeFieldsConfig || {};
    if (cfConfig.departmentRequired && !academicDetails.department) {
      const err = document.getElementById('error_acad_department');
      if (err) err.classList.remove('hidden');
      hasErrors = true;
    }
    if (cfConfig.facultyRequired && !academicDetails.faculty) {
      const err = document.getElementById('error_acad_faculty');
      if (err) err.classList.remove('hidden');
      hasErrors = true;
    }
    if (cfConfig.subjectRequired && !academicDetails.subject) {
      const err = document.getElementById('error_acad_subject');
      if (err) err.classList.remove('hidden');
      hasErrors = true;
    }

    // Validate Required Dynamic Questions that are currently visible
    if (currentForm && currentForm.questions) {
      currentForm.questions.forEach((q) => {
        const wrap = document.getElementById(`qwrap_${q.id}`);
        const isVisible = wrap && !wrap.classList.contains('hidden');

        if (isVisible && q.required) {
          const val = dynamicAnswers[q.id];
          if (val === undefined || val === null || val === '' || (Array.isArray(val) && val.length === 0)) {
            const err = document.getElementById(`error_${q.id}`);
            if (err) err.classList.remove('hidden');
            hasErrors = true;
          }
        }
      });
    }

    // Email validation if entered
    const emailInput = document.getElementById('customerEmail');
    const emailVal = emailInput.value.trim();
    if (emailVal && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(emailVal)) {
      document.getElementById('emailError').classList.remove('hidden');
      hasErrors = true;
    } else {
      document.getElementById('emailError').classList.add('hidden');
    }

    if (hasErrors) {
      const firstError = document.querySelector('.form-error:not(.hidden)');
      if (firstError) {
        firstError.scrollIntoView({ behavior: 'smooth', block: 'center' });
      }
      return;
    }

    // Submit payload
    const submitBtn = document.getElementById('submitBtn');
    submitBtn.disabled = true;
    submitBtn.textContent = 'Submitting Feedback...';

    // Find general comments from dynamic answers or dedicated field
    let generalComments = '';
    for (const [key, val] of Object.entries(dynamicAnswers)) {
      const qObj = (currentForm.questions || []).find(q => q.id === key);
      if (qObj && qObj.type === 'multiline') {
        generalComments = String(val);
        break;
      }
    }

    const payload = {
      formId: currentForm._id || currentForm.id,
      rating: selectedRating,
      customerName: document.getElementById('customerName').value.trim() || 'Anonymous',
      customerEmail: emailVal,
      customerPhone: document.getElementById('customerPhone').value.trim(),
      academicDetails: Object.keys(academicDetails).length > 0 ? academicDetails : null,
      comments: generalComments,
      answers: dynamicAnswers,
      source: 'Mobile Browser QR Scan'
    };

    try {
      const slug = getSlugFromUrl();
      const res = await fetch(`/api/feedback/submit/${encodeURIComponent(slug)}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload)
      });

      const result = await res.json();
      if (!res.ok) {
        throw new Error(result.error || 'Failed to submit feedback');
      }

      // Show success screen
      formEl.classList.add('hidden');
      const successCard = document.getElementById('successCard');
      successCard.classList.remove('hidden');

      document.getElementById('successHeading').textContent = result.rating >= 4
        ? 'Thank You So Much!'
        : 'Thank You for Your Feedback';

      document.getElementById('successMessage').textContent = result.message;

      // NON-GATED GOOGLE REVIEW CTA: Show to ALL respondents if configured!
      if (result.showGoogleReview && result.googleReviewUrl) {
        const cta = document.getElementById('googleReviewCta');
        const btn = document.getElementById('googleReviewBtn');
        btn.href = result.googleReviewUrl;
        cta.classList.remove('hidden');
      }

      window.scrollTo({ top: 0, behavior: 'smooth' });

    } catch (err) {
      const submitErr = document.getElementById('submitError');
      submitErr.textContent = err.message || 'An error occurred. Please try again.';
      submitErr.classList.remove('hidden');
      submitBtn.disabled = false;
      submitBtn.textContent = 'Submit Feedback';
    }
  });

  function escapeHtml(str) {
    if (!str) return '';
    return String(str).replace(/[&<>"']/g, function (m) {
      return ({
        '&': '&amp;',
        '<': '&lt;',
        '>': '&gt;',
        '"': '&quot;',
        "'": '&#39;'
      })[m];
    });
  }

  // Self initialize on DOM load
  document.addEventListener('DOMContentLoaded', loadForm);
})();
