// FeedbackHub Public Feedback Form Client

(function () {
  'use strict';

  let currentForm = null;
  let selectedRating = 0;
  let dynamicAnswers = {};

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
        throw new Error('Form not found or inactive');
      }

      const data = await res.json();
      currentForm = data.form;

      // Populate branding
      if (data.business) {
        document.getElementById('bizLogo').textContent = data.business.logo || '🏢';
        document.getElementById('bizName').textContent = data.business.name;
        document.title = `${data.business.name} - Customer Feedback`;
      }
      if (data.location) {
        document.getElementById('locName').textContent = `${data.location.name} • ${data.location.address}`;
      } else {
        document.getElementById('locName').textContent = 'We value your honest feedback';
      }

      if (currentForm.description) {
        document.getElementById('formDescription').textContent = currentForm.description;
      }

      renderDynamicQuestions(currentForm.questions || []);

      loadingEl.classList.add('hidden');
      formEl.classList.remove('hidden');
      initStarSelector();
    } catch (err) {
      loadingEl.classList.add('hidden');
      errorEl.classList.remove('hidden');
      document.getElementById('errorMessage').textContent = err.message || 'Unable to load feedback form.';
    }
  }

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
      });

      btn.addEventListener('mouseenter', () => {
        updateStarsDisplay(val, true);
      });

      btn.addEventListener('mouseleave', () => {
        updateStarsDisplay(selectedRating, false);
      });

      // Keyboard support
      btn.addEventListener('keydown', (e) => {
        if (e.key === 'ArrowRight' && index < buttons.length - 1) {
          buttons[index + 1].focus();
        } else if (e.key === 'ArrowLeft' && index > 0) {
          buttons[index - 1].focus();
        }
      });
    });
  }

  function updateStarsDisplay(ratingVal, isHover = false) {
    const buttons = document.querySelectorAll('.star-rating-btn');
    buttons.forEach((btn, index) => {
      const val = index + 1;
      if (val <= ratingVal) {
        btn.classList.add('active');
        btn.style.color = '#f59e0b';
      } else {
        btn.classList.remove('active');
        btn.style.color = '#cbd5e1';
      }
    });
  }

  function renderDynamicQuestions(questions) {
    const container = document.getElementById('dynamicQuestionsContainer');
    container.innerHTML = '';

    questions.forEach((q) => {
      // If question is the primary rating and already in markup, skip or configure
      if (q.type === 'rating' && q.id === 'q1') {
        document.getElementById('primaryRatingLabel').innerHTML =
          `${escapeHtml(q.text)} <span class="required">*</span>`;
        return;
      }

      const group = document.createElement('div');
      group.className = 'form-group';
      group.id = `group_${q.id}`;

      const label = document.createElement('label');
      label.className = 'form-label';
      label.innerHTML = `${escapeHtml(q.text)}${q.required ? ' <span class="required">*</span>' : ''}`;
      group.appendChild(label);

      if (q.type === 'nps') {
        const npsWrap = document.createElement('div');
        npsWrap.className = 'nps-selector';
        npsWrap.setAttribute('role', 'radiogroup');

        for (let i = 0; i <= 10; i++) {
          const btn = document.createElement('button');
          btn.type = 'button';
          btn.className = 'nps-btn';
          btn.textContent = i;
          btn.setAttribute('aria-label', `Score ${i}`);
          btn.addEventListener('click', () => {
            dynamicAnswers[q.id] = i;
            npsWrap.querySelectorAll('.nps-btn').forEach(b => b.classList.remove('active'));
            btn.classList.add('active');
            clearFieldError(q.id);
          });
          npsWrap.appendChild(btn);
        }
        group.appendChild(npsWrap);

        const npsLabels = document.createElement('div');
        npsLabels.style.display = 'flex';
        npsLabels.style.justifyContent = 'space-between';
        npsLabels.style.fontSize = '0.75rem';
        npsLabels.style.color = 'var(--neutral-500)';
        npsLabels.style.marginTop = '4px';
        npsLabels.innerHTML = '<span>0 = Not likely</span><span>10 = Extremely likely</span>';
        group.appendChild(npsLabels);

      } else if (q.type === 'choice' && Array.isArray(q.options)) {
        const chipsWrap = document.createElement('div');
        chipsWrap.className = 'choice-chips';

        q.options.forEach((opt) => {
          const chip = document.createElement('button');
          chip.type = 'button';
          chip.className = 'choice-chip';
          chip.textContent = opt;
          chip.addEventListener('click', () => {
            dynamicAnswers[q.id] = opt;
            chipsWrap.querySelectorAll('.choice-chip').forEach(c => c.classList.remove('active'));
            chip.classList.add('active');
            clearFieldError(q.id);
          });
          chipsWrap.appendChild(chip);
        });
        group.appendChild(chipsWrap);

      } else if (q.type === 'yesno') {
        const toggleWrap = document.createElement('div');
        toggleWrap.className = 'yesno-toggle';

        const yesBtn = document.createElement('button');
        yesBtn.type = 'button';
        yesBtn.className = 'yesno-btn';
        yesBtn.innerHTML = '<span>👍</span> Yes';
        yesBtn.addEventListener('click', () => {
          dynamicAnswers[q.id] = 'yes';
          noBtn.classList.remove('active-no');
          yesBtn.classList.add('active-yes');
          clearFieldError(q.id);
        });

        const noBtn = document.createElement('button');
        noBtn.type = 'button';
        noBtn.className = 'yesno-btn';
        noBtn.innerHTML = '<span>👎</span> No';
        noBtn.addEventListener('click', () => {
          dynamicAnswers[q.id] = 'no';
          yesBtn.classList.remove('active-yes');
          noBtn.classList.add('active-no');
          clearFieldError(q.id);
        });

        toggleWrap.appendChild(yesBtn);
        toggleWrap.appendChild(noBtn);
        group.appendChild(toggleWrap);

      } else if (q.type === 'text' || q.multiline) {
        const textarea = document.createElement('textarea');
        textarea.className = 'form-textarea';
        textarea.placeholder = q.placeholder || 'Your thoughts...';
        textarea.rows = 3;
        textarea.addEventListener('input', (e) => {
          dynamicAnswers[q.id] = e.target.value;
          clearFieldError(q.id);
        });
        group.appendChild(textarea);

      } else {
        const input = document.createElement('input');
        input.type = 'text';
        input.className = 'form-input';
        input.placeholder = q.placeholder || '';
        input.addEventListener('input', (e) => {
          dynamicAnswers[q.id] = e.target.value;
          clearFieldError(q.id);
        });
        group.appendChild(input);
      }

      // Error message container for dynamic field
      const err = document.createElement('div');
      err.className = 'form-error hidden';
      err.id = `error_${q.id}`;
      err.textContent = 'This field is required';
      group.appendChild(err);

      container.appendChild(group);
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

    // Validate Required Dynamic Questions
    if (currentForm && currentForm.questions) {
      currentForm.questions.forEach((q) => {
        if (q.type === 'rating' && q.id === 'q1') return;
        if (q.required) {
          const val = dynamicAnswers[q.id];
          if (val === undefined || val === null || val === '') {
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
      // Scroll to first error
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

    const payload = {
      formId: currentForm.id,
      rating: selectedRating,
      nps: dynamicAnswers['q2'] !== undefined ? dynamicAnswers['q2'] : null,
      customerName: document.getElementById('customerName').value,
      customerEmail: emailVal,
      customerPhone: document.getElementById('customerPhone').value,
      comments: dynamicAnswers['q5'] || dynamicAnswers['comments'] || '',
      answers: dynamicAnswers,
      source: 'Mobile Browser QR Scan'
    };

    try {
      const res = await fetch('/api/feedback/submit', {
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

      document.getElementById('successHeading').textContent = result.isPositive
        ? 'Thank You So Much!'
        : 'Thank You for Your Feedback';

      document.getElementById('successMessage').textContent = result.message;

      // Google Review prompt
      if (result.showGoogleReview && result.googleReviewUrl) {
        const cta = document.getElementById('googleReviewCta');
        const btn = document.getElementById('googleReviewBtn');
        btn.href = result.googleReviewUrl;
        cta.classList.remove('hidden');
      }

      // Smooth scroll to top of card
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
    return str.replace(/[&<>"']/g, function (m) {
      return ({
        '&': '&amp;',
        '<': '&lt;',
        '>': '&gt;',
        '"': '&quot;',
        "'": '&#39;'
      })[m];
    });
  }

  // Initialize on load
  document.addEventListener('DOMContentLoaded', loadForm);
})();
