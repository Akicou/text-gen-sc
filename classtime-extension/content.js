(() => {
  'use strict';

  if (window.__classtimeAILoaded) return;
  window.__classtimeAILoaded = true;

  const DEBUG_PREFIX = '[CTQ]';

  function log(...args) {
    console.log(DEBUG_PREFIX, ...args);
  }

  function logError(...args) {
    console.error(DEBUG_PREFIX, ...args);
  }

  // Store original Cloze choices before React state changes affect DOM
  let originalClozeGroups = [];

  // ========== AGGRESSIVE CLICK HELPERS ==========

  // More aggressive React event trigger - try everything
  function triggerClick(el, label = '') {
    if (!el) {
      logError('triggerClick called with null element', label);
      return false;
    }

    log(`triggerClick on:`, label || el.tagName, el.className);

    // Method 1: Native click with full event chain
    const eventTypes = ['mouseover', 'mouseenter', 'mousedown', 'mouseup', 'click'];
    for (const type of eventTypes) {
      const evt = new MouseEvent(type, {
        bubbles: true,
        cancelable: true,
        view: window,
        detail: 1,
        buttons: 1
      });
      el.dispatchEvent(evt);
    }

    // Method 2: Pointer events (for modern browsers)
    const ptrDown = new PointerEvent('pointerdown', {
      bubbles: true, cancelable: true, pointerId: 1, pressure: 0.5
    });
    const ptrUp = new PointerEvent('pointerup', {
      bubbles: true, cancelable: true, pointerId: 1, pressure: 0
    });
    el.dispatchEvent(ptrDown);
    el.dispatchEvent(ptrUp);

    // Method 3: Focus events
    el.dispatchEvent(new FocusEvent('focus', { bubbles: true }));

    // Method 4: Direct click
    el.click();

    // Method 5: Try to find and trigger React's internal onClick
    const reactKey = Object.keys(el).find(k => k.startsWith('__reactProps'));
    if (reactKey) {
      log('Found React props key:', reactKey);
      const props = el[reactKey];
      if (props && props.onClick) {
        try {
          props.onClick({ preventDefault: () => {}, stopPropagation: () => {} });
          log('React onClick called directly');
          return true;
        } catch (e) {
          logError('React onClick error:', e);
        }
      }
    }

    // Method 6: For inputs, also trigger change
    if (el.tagName === 'INPUT' || el.tagName === 'TEXTAREA') {
      el.dispatchEvent(new Event('change', { bubbles: true }));
      el.dispatchEvent(new Event('input', { bubbles: true }));
    }

    return true;
  }

  // Click a checkbox/radio choice - multiple aggressive approaches
  function clickChoiceByIndex(index, isRadio = false) {
    log(`clickChoiceByIndex: index=${index}, isRadio=${isRadio}`);

    const selectors = [
      // Direct choice wrapper approach
      () => {
        const wrappers = document.querySelectorAll('[data-testid="choice-wrapper"]');
        log(`Approach 1: found ${wrappers.length} choice wrappers`);
        const wrapper = wrappers[index];
        if (!wrapper) return null;

        // Try multiple paths to the clickable element
        const candidates = [
          wrapper.querySelector('span.MuiButtonBase-root'),
          wrapper.querySelector('.PrivateSwitchBase-root'),
          wrapper.querySelector('input[type=checkbox], input[type=radio]'),
          wrapper.querySelector('label'),
          wrapper.querySelector('[data-testid="multiple-answer-choice"]'),
          wrapper
        ];

        const found = candidates.find(el => el);
        log('Approach 1 candidate:', found?.className || found?.tagName);
        return found;
      },
      // MuiButtonBase direct search
      () => {
        const buttons = document.querySelectorAll('span.MuiButtonBase-root.MuiCheckbox-root, span.MuiButtonBase-root.MuiRadio-root');
        log(`Approach 2: found ${buttons.length} MuiButtonBase elements`);
        return buttons[index];
      },
      // Input direct
      () => {
        const inputs = document.querySelectorAll('input[type=checkbox], input[type=radio]');
        log(`Approach 3: found ${inputs.length} input elements`);
        return inputs[index];
      }
    ];

    for (let i = 0; i < selectors.length; i++) {
      const el = selectors[i]();
      if (el) {
        log(`Using approach ${i + 1}, element:`, el.tagName, el.className);
        // For inputs, also check the parent MuiButtonBase
        let target = el;
        if (el.tagName === 'INPUT') {
          const parentSpan = el.closest('span.MuiButtonBase-root');
          if (parentSpan) {
            log('Found parent MuiButtonBase, clicking both');
            triggerClick(parentSpan, 'MuiButtonBase parent');
            triggerClick(el, 'input element');
            return true;
          }
        }
        triggerClick(target, `choice index ${index}`);
        return true;
      }
    }
    logError('No element found for index:', index);
    return false;
  }

  // Click cloze/highlight text choice
  // Uses originalChoices for index-based matching since DOM text changes after clicks
  function clickClozeChoice(groupIndex, choiceText, originalChoices = []) {
    log(`clickClozeChoice: groupIndex=${groupIndex}, choice="${choiceText}"`);

    // Get all groups that actually contain choice buttons (not just any role="group")
    const allGroups = document.querySelectorAll('[role="group"]');
    log(`Found ${allGroups.length} role=group elements total`);

    // Filter to only groups that have highlight-text-choice buttons
    const choiceGroups = Array.from(allGroups).filter(g =>
      g.querySelector('[data-testid="highlight-text-choice"], button.css-10uln1x-choice')
    );
    log(`Found ${choiceGroups.length} groups with choice buttons`);

    if (groupIndex >= choiceGroups.length) {
      logError('Group index out of bounds:', groupIndex, 'max:', choiceGroups.length - 1);
      return false;
    }

    const group = choiceGroups[groupIndex];
    const buttons = group.querySelectorAll('[data-testid="highlight-text-choice"], button.css-10uln1x-choice');
    log(`Group ${groupIndex} has ${buttons.length} choice buttons`);

    // Use original choices for index-based matching (avoiding changed DOM text)
    if (originalChoices.length > 0) {
      const cleanTarget = clean(choiceText).toLowerCase();
      log(`Original choices for group ${groupIndex}:`, originalChoices);

      // Find the index of the target choice in the original choices array
      const targetIndex = originalChoices.findIndex(choice => {
        const cleanChoice = clean(choice).toLowerCase();
        return cleanChoice === cleanTarget || cleanChoice.includes(cleanTarget) || cleanTarget.includes(cleanChoice);
      });

      if (targetIndex >= 0 && targetIndex < buttons.length) {
        log(`Found choice "${choiceText}" at original index ${targetIndex}, clicking button at that index`);
        const btn = buttons[targetIndex];
        triggerClick(btn, `cloze choice: ${choiceText} (index ${targetIndex})`);
        btn.setAttribute('data-test-selected', 'true');
        btn.classList.add('ctq-selected');
        return true;
      }
      logError('Choice not found in original choices:', choiceText);
    }

    // Fallback: try text matching with current DOM (may not work after state changes)
    log('Falling back to text matching (may fail if DOM changed)');
    const cleanTarget = clean(choiceText).toLowerCase();
    log('Looking for:', cleanTarget);

    for (let i = 0; i < buttons.length; i++) {
      const btn = buttons[i];
      const btnText = clean(btn.textContent || '').toLowerCase();
      log(`  Button ${i}: "${btnText}"`);

      // More flexible matching: exact match, substring match either way
      if (btnText === cleanTarget || btnText.includes(cleanTarget) || cleanTarget.includes(btnText)) {
        log('  -> MATCH! Clicking button');
        triggerClick(btn, `cloze choice: ${btnText}`);
        btn.setAttribute('data-test-selected', 'true');
        btn.classList.add('ctq-selected');
        return true;
      }
    }
    logError('No matching button found for:', choiceText, '(cleaned:', cleanTarget, ')');
    return false;
  }

  // Click categorizer table cell
  function clickCategorizerCell(itemText, categoryText) {
    const targetLabel = `${itemText.trim()}, ${categoryText.trim()}`.toLowerCase();
    log(`clickCategorizerCell: "${targetLabel}"`);

    // Find checkbox by aria-label
    const checkboxes = document.querySelectorAll('input[type=checkbox][aria-label]');
    log(`Found ${checkboxes.length} checkboxes with aria-label`);

    for (const cb of checkboxes) {
      const label = (cb.getAttribute('aria-label') || '').toLowerCase();
      log(`  Checking aria-label: "${label}"`);
      if (label === targetLabel || label.includes(itemText.toLowerCase())) {
        log('  MATCH! Clicking...');
        // Find the MuiButtonBase parent and click it
        const muiRoot = cb.closest('span.MuiButtonBase-root');
        if (muiRoot) {
          triggerClick(muiRoot, 'categorizer MuiButtonBase');
        }
        triggerClick(cb, 'categorizer checkbox');
        return true;
      }
    }

    // Fallback: find by table position
    const table = document.querySelector('table[role="grid"]');
    if (!table) {
      logError('No categorizer table found');
      return false;
    }

    const headers = Array.from(table.querySelectorAll('[data-testid="category-header-cell"]'));
    const rows = Array.from(table.querySelectorAll('[data-testid="question-answer-row"]'));

    log(`Table has ${headers.length} headers, ${rows.length} rows`);

    const catIdx = headers.findIndex(th =>
      th.textContent?.trim().toLowerCase() === categoryText.toLowerCase()
    );
    const rowIdx = rows.findIndex(tr =>
      tr.textContent?.trim().toLowerCase().includes(itemText.toLowerCase())
    );

    log(`Category index: ${catIdx}, Row index: ${rowIdx}`);

    if (catIdx >= 0 && rowIdx >= 0) {
      const cell = rows[rowIdx].querySelectorAll('td')[catIdx];
      if (cell) {
        const cb = cell.querySelector('input[type=checkbox]');
        if (cb) {
          const muiRoot = cb.closest('span.MuiButtonBase-root');
          if (muiRoot) triggerClick(muiRoot, 'categorizer MuiButtonBase (fallback)');
          triggerClick(cb, 'categorizer checkbox (fallback)');
          return true;
        }
      }
    }

    logError('Categorizer cell not found');
    return false;
  }

  // Fill open text
  function fillOpenText(text) {
    log(`fillOpenText: "${text.substring(0, 50)}..."`);

    const textarea = document.querySelector('[data-testid="student-answer-area"] textarea:not([aria-hidden="true"])');
    if (!textarea) {
      logError('No textarea found');
      return false;
    }

    const wasDisabled = textarea.disabled || textarea.classList.contains('Mui-disabled');
    log('Found textarea, disabled:', wasDisabled);

    // If disabled, try clicking change answer button first
    if (wasDisabled) {
      const changeBtn = document.querySelector('[data-testid="change-answer-link"]');
      if (changeBtn) {
        log('Clicking change answer button...');
        triggerClick(changeBtn, 'change answer button');
      }
      // Temporarily enable for manipulation
      try {
        textarea.disabled = false;
        textarea.classList.remove('Mui-disabled');
        textarea.removeAttribute('disabled');
      } catch (e) {
        logError('Could not enable textarea:', e);
      }
    }

    // Set value using native property descriptor
    const nativeInputValueSetter = Object.getOwnPropertyDescriptor(
      HTMLTextAreaElement.prototype,
      'value'
    ).set;

    nativeInputValueSetter.call(textarea, text);

    // Dispatch all relevant events
    const events = [
      new Event('input', { bubbles: true }),
      new Event('change', { bubbles: true }),
      new KeyboardEvent('keydown', { bubbles: true }),
      new KeyboardEvent('keyup', { bubbles: true }),
      new FocusEvent('focus', { bubbles: true })
    ];

    events.forEach(e => textarea.dispatchEvent(e));

    // Also set React's internal state
    for (const key of Object.keys(textarea)) {
      if (key.startsWith('__react')) {
        log('Found React key on textarea:', key);
        const fiber = textarea[key];
        if (fiber && fiber.memoizedProps) {
          fiber.memoizedProps.value = text;
        }
      }
    }

    textarea.value = text;
    textarea.focus();
    log('Textarea value set');
    return true;
  }

  // Aggressive sorter reordering - try multiple methods to actually reorder items
  function reorderSorter(targetOrder) {
    log(`reorderSorter: ${targetOrder.length} items in target order`);
    const cards = Array.from(document.querySelectorAll('[data-testid="student-sorter-choice"]'));
    const container = cards[0]?.closest('[data-testid="questions-answers-list"], .css-hqx06x-sorterChoicesList, .sorterChoicesList');

    if (!container || cards.length === 0) {
      log('No cards or container found for reordering');
      return false;
    }

    log(`Found ${cards.length} cards, container:`, container.className);

    // Build array of (card, targetPosition) based on text matching
    const cardTargets = cards.map(card => {
      const text = getText(card.querySelector('[data-testid="student-sorter-choice-content"]') || card).toLowerCase();
      // Find target position
      let targetPos = targetOrder.findIndex(t =>
        clean(t).toLowerCase().includes(text) || text.includes(clean(t).toLowerCase())
      );
      if (targetPos === -1) {
        // Try partial matching
        targetPos = targetOrder.findIndex(t => {
          const cleanT = clean(t).toLowerCase();
          const words = text.split(/\s+/);
          return words.some(w => w.length > 3 && cleanT.includes(w));
        });
      }
      return { card, text, targetPos: targetPos >= 0 ? targetPos : 999 };
    }).sort((a, b) => a.targetPos - b.targetPos);

    log('Card target positions:', cardTargets.map(c => `${c.text.substring(0,15)}->${c.targetPos}`));

    // Method 1: Try dnd-kit activators (common in React apps)
    for (const { card, targetPos } of cardTargets) {
      const activator = card.querySelector('[data-dnd-kit-drag-handle]') || card;
      try {
        // Find dnd-kit context
        const draggableId = card.getAttribute('data-dnd-kit-draggable-id');
        if (draggableId) {
          log(`Found dnd-kit draggable: ${draggableId}`);
          // Try to trigger dnd-kit's internal state update
          const dndEvent = new CustomEvent('dnd-kit dragStart', { bubbles: true, detail: { id: draggableId } });
          activator.dispatchEvent(dndEvent);
        }
      } catch (e) {
        logError('dnd-kit method failed:', e);
      }
    }

    // Method 2: Direct DOM reordering (brute force)
    try {
      log('Attempting direct DOM reordering...');
      // Clone cards in target order
      const fragment = document.createDocumentFragment();
      cardTargets.forEach(({ card }) => {
        const clone = card.cloneNode(true);
        fragment.appendChild(clone);
      });

      // Replace all cards with reordered clones
      cardTargets.forEach(({ card }) => card.remove());

      // Insert in correct order
      const listContainer = container.querySelector('.css-hqx06x-sorterChoicesList, .sorterChoicesList') || container;
      Array.from(fragment.children).forEach((clone, i) => {
        listContainer.appendChild(clone);
        log(`Repositioned item ${i + 1}`);
      });

      log('DOM reordering completed');
      return true;
    } catch (e) {
      logError('Direct DOM reordering failed:', e);
    }

    // Method 3: Try React Fiber manipulation
    try {
      log('Trying React Fiber manipulation...');
      const reactKey = Object.keys(container).find(k => k.startsWith('__reactFiber') || k.startsWith('__reactProps'));
      if (reactKey) {
        log('Found React internal key:', reactKey);
        // Force React to re-render by dispatching events
        container.dispatchEvent(new Event('input', { bubbles: true }));
        container.dispatchEvent(new Event('change', { bubbles: true }));
      }
    } catch (e) {
      logError('React manipulation failed:', e);
    }

    return false;
  }

  // Annotate sorter items (drag-drop is too complex, just show hints)
  function annotateSorter(order) {
    log(`annotateSorter: ${order.length} items`);

    const cards = document.querySelectorAll('[data-testid="student-sorter-choice"]');
    log(`Found ${cards.length} sorter cards`);

    cards.forEach((card) => {
      const text = card.textContent?.trim().toLowerCase() || '';
      const pos = order.findIndex(t =>
        t.trim().toLowerCase().includes(text) || text.includes(t.trim().toLowerCase())
      );

      let badge = card.querySelector('.ctq-sort-hint');
      if (!badge) {
        badge = document.createElement('div');
        badge.className = 'ctq-sort-hint';
        badge.style.cssText = `
          position: absolute;
          top: -8px;
          right: -8px;
          background: #7c3aed;
          color: white;
          border-radius: 50%;
          width: 24px;
          height: 24px;
          display: flex;
          align-items: center;
          justify-content: center;
          font-size: 11px;
          font-weight: bold;
          z-index: 100;
        `;
        card.style.position = 'relative';
        card.appendChild(badge);
      }
      badge.textContent = pos >= 0 ? pos + 1 : '?';
      log(`Card "${text.substring(0, 20)}" -> position ${pos + 1}`);
    });
  }

  // ========== QUESTION EXTRACTION ==========

  const clean = (s) => (s || '').replace(/\s+/g, ' ').trim();

  function getText(el) {
    return el ? clean(el.textContent) : '';
  }

  function getQuestionTitle() {
    const title = document.querySelector('[data-testid="student-session-question-title"]');
    const text = getText(title);
    log('getQuestionTitle:', text);
    return text;
  }

  function getQuestionDescription() {
    const el = document.querySelector('.styles__paragraphWithLinks-f74d2d, .styles__textToSpeechText-b1d7e7');
    const text = getText(el);
    log('getQuestionDescription:', text.substring(0, 100));
    return text;
  }

  function detectQuestionType() {
    const tests = [
      ['categorizer', document.querySelector('[data-testid="student-categorizer-answers-form"]')],
      ['cloze', document.querySelector('[data-testid="highlight-text-preview"]')],
      ['sorter', document.querySelector('[data-testid="student-sorter-choice"]')],
      ['opentext', document.querySelector('[data-testid="student-answer-area"]')],
    ];

    for (const [type, el] of tests) {
      if (el) {
        log('Detected type:', type);
        return type;
      }
    }

    const list = document.querySelector('[data-testid="questions-answers-list"]');
    if (list?.querySelector('input[type=radio]')) {
      log('Detected type: singlechoice');
      return 'singlechoice';
    }
    if (list?.querySelector('input[type=checkbox]')) {
      log('Detected type: multichoice');
      return 'multichoice';
    }

    log('Detected type: unknown');
    return 'unknown';
  }

  function extractMultichoice() {
    const wrappers = document.querySelectorAll('[data-testid="choice-wrapper"]');
    log(`extractMultichoice: ${wrappers.length} wrappers`);
    return {
      type: 'Multiple Choice',
      title: getQuestionTitle(),
      description: getQuestionDescription(),
      options: Array.from(wrappers).map((w, i) => ({
        index: i + 1,
        text: getText(w)
      }))
    };
  }

  function extractSinglechoice() {
    const wrappers = document.querySelectorAll('[data-testid="choice-wrapper"]');
    log(`extractSinglechoice: ${wrappers.length} wrappers`);
    return {
      type: 'Single Choice',
      title: getQuestionTitle(),
      description: getQuestionDescription(),
      options: Array.from(wrappers).map((w, i) => ({
        index: i + 1,
        text: getText(w)
      }))
    };
  }

  function extractCategorizer() {
    const headers = Array.from(document.querySelectorAll('[data-testid="category-header-cell"]'))
      .map(th => getText(th));
    const rows = Array.from(document.querySelectorAll('[data-testid="question-answer-row"]'))
      .map(tr => getText(tr.querySelector('th')));
    log(`extractCategorizer: ${headers.length} headers, ${rows.length} rows`);
    return {
      type: 'Categorizer',
      title: getQuestionTitle(),
      description: getQuestionDescription(),
      categories: headers,
      items: rows
    };
  }

  function extractOpentext() {
    const audioEl = document.querySelector('audio[src]');
    log(`extractOpentext: audio=${!!audioEl}`);
    return {
      type: 'Open Text',
      title: getQuestionTitle(),
      description: getQuestionDescription(),
      audioSrc: audioEl?.src || null
    };
  }

  function extractSorter() {
    const cards = document.querySelectorAll('[data-testid="student-sorter-choice"]');
    log(`extractSorter: ${cards.length} cards`);
    return {
      type: 'Sorter',
      title: getQuestionTitle(),
      description: getQuestionDescription(),
      items: Array.from(cards).map(card => ({
        text: getText(card.querySelector('[data-testid="student-sorter-choice-content"]') || card)
      }))
    };
  }

  function extractCloze() {
    const preview = document.querySelector('[data-testid="highlight-text-preview"]');
    const groups = Array.from(preview?.querySelectorAll('[role="group"]') || []).map((g, i) => ({
      groupIndex: i,
      choices: Array.from(g.querySelectorAll('[data-testid="highlight-text-choice"]')).map(btn =>
        getText(btn)
      )
    }));
    originalClozeGroups = groups; // Store for later use in clickClozeChoice
    log(`extractCloze: ${groups.length} groups`);
    return {
      type: 'Cloze',
      title: getQuestionTitle(),
      description: getQuestionDescription(),
      fullText: getText(preview),
      groups
    };
  }

  function extractQuestion() {
    log('=== extractQuestion called ===');
    const type = detectQuestionType();
    log('Question type:', type);

    let result;
    switch (type) {
      case 'multichoice': result = extractMultichoice(); break;
      case 'singlechoice': result = extractSinglechoice(); break;
      case 'categorizer': result = extractCategorizer(); break;
      case 'opentext': result = extractOpentext(); break;
      case 'sorter': result = extractSorter(); break;
      case 'cloze': result = extractCloze(); break;
      default: result = { type: 'Unknown', title: getQuestionTitle() };
    }

    log('Extracted data:', JSON.stringify(result, null, 2));
    return result;
  }

  // ========== FORMAT TRANSFORMATION (Classtime -> Moodle) ==========

  function toMoodleFormat(data) {
    log('toMoodleFormat input:', JSON.stringify(data).substring(0, 200));

    // Build question text from title and description
    let questionText = data.title || '';
    if (data.description) {
      questionText += '\n\n' + data.description;
    }

    const result = {
      type: data.type,
      questionText: questionText,
    };

    // Transform options based on question type
    switch (data.type) {
      case 'Single Choice':
        // Moodle doesn't have "Single Choice" - use "Multiple Choice" instead
        result.type = 'Multiple Choice';
        result.options = (data.options || []).map(opt => ({
          text: opt.text || '',
          correct: false,
          checked: false
        }));
        log('Converted "Single Choice" to "Multiple Choice" for Moodle compatibility');
        break;

      case 'Multiple Choice':
        result.type = 'Multiple Choice';
        result.options = (data.options || []).map(opt => ({
          text: opt.text || '',
          correct: false,
          checked: false
        }));
        break;

      case 'Categorizer':
        // Convert categorizer to a match-style format
        result.type = 'Zuordnung (Match)';
        result.items = (data.items || []).map(item => ({
          statement: item,
          selected: null
        }));
        result.matchOptions = data.categories || [];
        break;

      case 'Cloze':
        // Convert cloze to gapselect format
        result.type = 'Lückentext (Gap Select)';
        result.gaps = (data.groups || []).map((g, i) => ({
          index: i + 1,
          options: g.choices || [],
          selected: null
        }));
        break;

      case 'Sorter':
        result.items = data.items || [];
        break;

      case 'Open Text':
        result.audioSrc = data.audioSrc;
        break;

      default:
        result.options = [];
    }

    log('toMoodleFormat output:', JSON.stringify(result).substring(0, 200));
    return result;
  }

  // Transform Moodle AI response back to Classtime format for autoFill
  function fromMoodleResponse(moodleResult, classtimeType, originalOptions) {
    log('fromMoodleResponse: type=', classtimeType, 'result=', JSON.stringify(moodleResult).substring(0, 200));
    log('fromMoodleResponse: originalOptions=', originalOptions ? JSON.stringify(originalOptions) : 'none');

    const result = { ...moodleResult };

    switch (classtimeType) {
      case 'Multiple Choice':
        // Moodle returns correctAnswers array, already compatible
        // Also handle if backend returns just "antwort" or "answer" text
        if (moodleResult.antwort || moodleResult.answer) {
          const textAnswer = (moodleResult.antwort || moodleResult.answer || '').toLowerCase().trim();
          log('Text answer received:', textAnswer, 'matching against options...');

          // Try to match against option text
          const matchedIndex = (originalOptions || []).findIndex(opt => {
            const optText = opt.text?.toLowerCase().trim() || '';
            return optText.includes(textAnswer) || textAnswer.includes(optText);
          });

          if (matchedIndex >= 0) {
            result.correctAnswers = [matchedIndex + 1];
            log('Matched to option index:', matchedIndex + 1);
          }
        }
        break;

      case 'Single Choice':
        // Moodle returns correctAnswer number, already compatible
        // Also handle text answer fallback
        if (moodleResult.antwort || moodleResult.answer) {
          const textAnswer = (moodleResult.antwort || moodleResult.answer || '').toLowerCase().trim();
          log('Text answer received for Single Choice:', textAnswer);

          const matchedIndex = (originalOptions || []).findIndex(opt => {
            const optText = opt.text?.toLowerCase().trim() || '';
            log('  Checking option:', optText, 'against answer:', textAnswer);

            // Special handling for Richtig/Falsch
            if (textAnswer.includes('richtig') || textAnswer.includes('wahr') || textAnswer === 'true' || textAnswer === 'r') {
              return optText === 'richtig' || optText === 'r' || optText === 'r.';
            }
            if (textAnswer.includes('falsch') || textAnswer === 'wrong' || textAnswer === 'false' || textAnswer === 'f') {
              return optText === 'falsch' || optText === 'f' || optText === 'f.';
            }
            return optText.includes(textAnswer) || textAnswer.includes(optText);
          });

          if (matchedIndex >= 0) {
            result.correctAnswer = matchedIndex + 1;
            log('Matched Single Choice to option index:', matchedIndex + 1, 'text:', originalOptions[matchedIndex].text);
          } else {
            log('No match found for answer:', textAnswer);
          }
        }
        break;

      case 'Categorizer':
        // Transform matches -> assignments
        if (moodleResult.matches) {
          result.assignments = moodleResult.matches.map(m => ({
            item: m.statement,
            category: m.answer
          }));
          delete result.matches;
        }
        break;

      case 'Cloze':
        // Transform gaps -> selections
        if (moodleResult.gaps) {
          result.selections = moodleResult.gaps.map(g => ({
            groupIndex: (g.gapNumber || g.index || 1) - 1,
            choice: g.answer || g.selected
          }));
          delete result.gaps;
        }
        break;

      case 'Sorter':
        // Moodle returns order array, already compatible
        break;

      case 'Open Text':
        // Moodle returns answer string, already compatible
        break;
    }

    log('fromMoodleResponse output:', JSON.stringify(result).substring(0, 200));
    return result;
  }

  // ========== AUTO-FILL ==========

  function normalizeAnswers(result) {
    let raw = result.correctAnswers ?? result.correct_answers
           ?? (result.correctAnswer != null ? result.correctAnswer : null)
           ?? (result.correct_answer != null ? result.correct_answer : null);
    if (raw == null) return [];
    if (!Array.isArray(raw)) raw = String(raw).split(/[,\s]+/);
    return raw.map(Number).filter(n => !isNaN(n) && n > 0);
  }

  function autoFill(data, result) {
    log('=== autoFill called ===');
    log('data.type:', data.type);
    log('result:', JSON.stringify(result, null, 2));

    let filled = 0;

    switch (data.type) {
      case 'Multiple Choice': {
        const answers = normalizeAnswers(result);
        log('Multiple Choice answers:', answers);
        answers.forEach(idx => {
          if (clickChoiceByIndex(idx - 1, false)) filled++;
        });
        break;
      }
      case 'Single Choice': {
        const answers = normalizeAnswers(result);
        log('Single Choice answers:', answers);
        if (answers.length > 0) {
          if (clickChoiceByIndex(answers[0] - 1, true)) filled = 1;
        }
        break;
      }
      case 'Categorizer': {
        if (!result.assignments) {
          log('No assignments in result');
          break;
        }
        log('Categorizer assignments:', result.assignments);
        result.assignments.forEach(({ item, category }) => {
          if (clickCategorizerCell(item, category)) filled++;
        });
        break;
      }
      case 'Open Text': {
        // Handle both 'answer' and 'antwort' (German) keys from AI
        const answer = result.answer || result.antwort || result.loesung || result.text;
        if (!answer) {
          log('No answer in result');
          break;
        }
        log('Open Text answer:', answer);
        if (fillOpenText(answer)) filled = 1;
        break;
      }
      case 'Sorter': {
        // Handle both 'order' and 'reihenfolge' keys from AI
        const sortOrder = result.order || result.reihenfolge || result.sorting;
        if (!sortOrder) {
          log('No order in result');
          break;
        }
        log('Sorter order:', sortOrder);
        // Try aggressive reordering first, fall back to hints
        if (reorderSorter(sortOrder)) {
          filled = sortOrder.length;
        } else {
          annotateSorter(sortOrder);
          filled = sortOrder.length;
        }
        break;
      }
      case 'Cloze': {
        if (!result.selections) {
          log('No selections in result');
          break;
        }
        log('Cloze selections:', result.selections);
        result.selections.forEach(({ groupIndex, choice }) => {
          const originalChoices = originalClozeGroups[groupIndex]?.choices || [];
          log(`Using original choices for group ${groupIndex}:`, originalChoices);
          if (clickClozeChoice(groupIndex, choice, originalChoices)) filled++;
        });
        break;
      }
      default:
        log('Unknown type, cannot auto-fill');
    }

    log('autoFill completed, filled:', filled);
    return filled;
  }

  // ========== UI HELPERS ==========

  function formatExtracted(data) {
    const lines = [`Type: ${data.type}`, `Question: ${data.title}`];
    if (data.description) lines.push(`Context: ${data.description}`);
    lines.push('');

    if (data.options) {
      lines.push('--- Options ---');
      data.options.forEach(o => lines.push(`${o.index}. ${o.text}`));
    }
    if (data.categories) {
      lines.push('--- Categories ---');
      data.categories.forEach((c, i) => lines.push(`${i + 1}. ${c}`));
      lines.push('--- Items ---');
      data.items.forEach((item, i) => lines.push(`${i + 1}. ${item}`));
    }
    if (data.items && data.type === 'Sorter') {
      lines.push('--- Items to order ---');
      data.items.forEach(it => lines.push(`- ${it.text}`));
    }
    if (data.groups) {
      lines.push('--- Gaps ---');
      data.groups.forEach(g => {
        lines.push(`Gap ${g.groupIndex + 1}: ${g.choices.join(' / ')}`);
      });
    }
    if (data.audioSrc) lines.push(`Audio: ${data.audioSrc}`);

    return lines.join('\n');
  }

  function formatAIResult(data, result) {
    const lines = ['\n=== AI ANSWER ===\n'];

    if (data.type === 'Multiple Choice') {
      const answers = result.correctAnswers || (result.correctAnswer ? [result.correctAnswer] : []);
      lines.push(`Correct: ${answers.join(', ')}`);
      if (result.explanation) lines.push(`Explanation: ${result.explanation}`);
    } else if (data.type === 'Single Choice') {
      lines.push(`Correct: ${result.correctAnswer}`);
      if (result.explanation) lines.push(`Explanation: ${result.explanation}`);
    } else if (data.type === 'Categorizer' && result.assignments) {
      result.assignments.forEach(a => lines.push(`${a.item} → ${a.category}`));
      if (result.explanation) lines.push(`\nExplanation: ${result.explanation}`);
    } else if (data.type === 'Open Text') {
      lines.push(`Answer: ${result.answer}`);
      if (result.explanation) lines.push(`Explanation: ${result.explanation}`);
    } else if (data.type === 'Sorter' && result.order) {
      lines.push('Correct order (1 = top):');
      result.order.forEach((t, i) => lines.push(`${i + 1}. ${t}`));
      if (result.explanation) lines.push(`\nExplanation: ${result.explanation}`);
    } else if (data.type === 'Cloze' && result.selections) {
      result.selections.forEach(s => lines.push(`Gap ${s.groupIndex + 1}: ${s.choice}`));
      if (result.explanation) lines.push(`\nExplanation: ${result.explanation}`);
    } else {
      lines.push(JSON.stringify(result, null, 2));
    }

    return lines.join('\n');
  }

  // ========== MODAL ==========

  const MODAL_ID = 'ctq-modal';

  function closeModal() {
    document.getElementById(MODAL_ID)?.remove();
  }

  function showModal(text, data) {
    log('showModal called');
    closeModal();

    const overlay = document.createElement('div');
    overlay.id = MODAL_ID;
    overlay.innerHTML = `
      <div class="ctq-overlay-bg"></div>
      <div class="ctq-modal-box">
        <div class="ctq-modal-header">
          <span class="ctq-modal-title">Classtime AI</span>
          <div class="ctq-modal-actions">
            <button class="ctq-btn ctq-solve-btn">AI Solve</button>
            <button class="ctq-btn ctq-fill-btn" style="display:none">Fill</button>
            <button class="ctq-btn ctq-copy-btn">Copy</button>
            <button class="ctq-btn ctq-close-btn">&times;</button>
          </div>
        </div>
        <textarea class="ctq-modal-text" spellcheck="false" readonly></textarea>
        <div class="ctq-modal-status"></div>
      </div>
    `;

    overlay.style.cssText = `
      position: fixed; inset: 0; z-index: 2147483647;
      display: flex; align-items: center; justify-content: center;
    `;

    overlay.querySelector('.ctq-overlay-bg').style.cssText = `
      position: absolute; inset: 0;
      background: rgba(0,0,0,0.5);
    `;

    overlay.querySelector('.ctq-modal-box').style.cssText = `
      position: relative;
      background: white;
      width: min(700px, 90vw);
      max-height: 80vh;
      border-radius: 12px;
      box-shadow: 0 25px 50px rgba(0,0,0,0.4);
      display: flex; flex-direction: column;
      font-family: system-ui, sans-serif;
    `;

    overlay.querySelector('.ctq-modal-header').style.cssText = `
      display: flex; justify-content: space-between; align-items: center;
      padding: 12px 16px; border-bottom: 1px solid #e5e7eb; background: #f9fafb;
      border-radius: 12px 12px 0 0;
    `;

    overlay.querySelector('.ctq-modal-title').style.cssText = `
      font-weight: 600; font-size: 14px; color: #111827;
    `;

    overlay.querySelector('.ctq-modal-actions').style.cssText = `
      display: flex; gap: 8px;
    `;

    const btnStyle = `
      padding: 6px 12px; border-radius: 6px; border: none;
      font-size: 12px; font-weight: 500; cursor: pointer;
      transition: background 0.15s;
    `;

    overlay.querySelector('.ctq-solve-btn').style.cssText = `${btnStyle} background: #059669; color: white;`;
    overlay.querySelector('.ctq-fill-btn').style.cssText = `${btnStyle} background: #d97706; color: white;`;
    overlay.querySelector('.ctq-copy-btn').style.cssText = `${btnStyle} background: #2563eb; color: white;`;
    overlay.querySelector('.ctq-close-btn').style.cssText = `${btnStyle} background: #e5e7eb; color: #374151; min-width: 32px;`;

    overlay.querySelector('.ctq-modal-text').style.cssText = `
      flex: 1; min-height: 250px; margin: 0; padding: 14px;
      border: none; resize: none; outline: none;
      font-family: ui-monospace, monospace; font-size: 13px; line-height: 1.5;
      white-space: pre; overflow: auto;
    `;

    overlay.querySelector('.ctq-modal-status').style.cssText = `
      padding: 8px 16px; border-top: 1px solid #e5e7eb;
      font-size: 12px; color: #059669; min-height: 28px;
    `;

    document.body.appendChild(overlay);
    log('Modal added to DOM');

    const ta = overlay.querySelector('.ctq-modal-text');
    ta.value = text;

    const statusEl = overlay.querySelector('.ctq-modal-status');
    const setStatus = (msg) => {
      statusEl.textContent = msg;
      setTimeout(() => statusEl.textContent = '', 3000);
    };

    let lastResult = null;

    overlay.querySelector('.ctq-solve-btn').onclick = async () => {
      const btn = overlay.querySelector('.ctq-solve-btn');
      btn.disabled = true;
      btn.textContent = '...';
      setStatus('Asking AI...');
      log('AI Solve button clicked');

      try {
        // Transform to Moodle-compatible format for the backend
        const moodleData = toMoodleFormat(data);
        const reply = await browser.runtime.sendMessage({ action: 'solve', data: moodleData });
        log('AI reply received:', reply);

        if (!reply?.ok) throw new Error(reply?.error || 'No response');

        lastResult = fromMoodleResponse(reply.data, data.type, data.options);
        if (lastResult.error) throw new Error(lastResult.error);

        ta.value += formatAIResult(data, lastResult);
        overlay.querySelector('.ctq-fill-btn').style.display = '';
        setStatus('Done!');
      } catch (err) {
        logError('AI error:', err);
        ta.value += '\n\nError: ' + err.message;
        setStatus('Failed.');
      } finally {
        btn.disabled = false;
        btn.textContent = 'AI Solve';
      }
    };

    overlay.querySelector('.ctq-fill-btn').onclick = () => {
      log('Fill button clicked');
      if (!data || !lastResult) {
        setStatus('No data to fill');
        return;
      }
      const filled = autoFill(data, lastResult);
      setStatus(filled > 0 ? `Filled ${filled} item(s)` : 'Fill failed');
    };

    overlay.querySelector('.ctq-copy-btn').onclick = async () => {
      try {
        await navigator.clipboard.writeText(ta.value);
        setStatus('Copied!');
      } catch {
        setStatus('Copy failed');
      }
    };

    overlay.querySelector('.ctq-close-btn').onclick = closeModal;
    overlay.querySelector('.ctq-overlay-bg').onclick = closeModal;

    document.addEventListener('keydown', (e) => {
      if (e.key === 'Escape') closeModal();
    }, { once: true });
  }

  // ========== BUTTON INJECTION ==========

  function injectButtons() {
    log('=== injectButtons called ===');

    const qEl = document.querySelector('#sessionQuestion');
    if (!qEl) {
      log('No #sessionQuestion found');
      return;
    }
    log('Found #sessionQuestion');

    // Find the answer button wrapper - insert buttons right after it
    const answerWrapper = qEl.querySelector('.styles__answerButtonWrapper-a7f53e');
    if (!answerWrapper) {
      log('No .styles__answerButtonWrapper-a7f53e found');
      return;
    }
    log('Found answer wrapper');

    // Check if already injected
    if (answerWrapper.parentElement.querySelector('.ctq-btn-group')) {
      log('Buttons already injected');
      return;
    }

    log('Creating buttons...');

    // Create button group with inline styles (more reliable than CSS file)
    const group = document.createElement('div');
    group.className = 'ctq-btn-group';
    group.style.cssText = `
      display: flex;
      gap: 8px;
      justify-content: center;
      margin-top: 8px;
      opacity: 0;
      transition: opacity 0.2s ease;
    `;

    const aiBtn = document.createElement('button');
    aiBtn.type = 'button';
    aiBtn.className = 'ctq-btn ctq-ai-btn';
    aiBtn.title = 'AI solve & auto-fill';
    aiBtn.textContent = '🤖 AI';
    aiBtn.style.cssText = `
      font-family: system-ui, sans-serif;
      font-size: 12px;
      font-weight: 500;
      padding: 5px 12px;
      border-radius: 6px;
      border: none;
      cursor: pointer;
      background: #10b981;
      color: white;
      box-shadow: 0 1px 3px rgba(0,0,0,0.2);
    `;
    aiBtn.onmouseover = () => aiBtn.style.background = '#059669';
    aiBtn.onmouseout = () => aiBtn.style.background = '#10b981';

    const showBtn = document.createElement('button');
    showBtn.type = 'button';
    showBtn.className = 'ctq-btn ctq-show-btn';
    showBtn.title = 'Show details';
    showBtn.textContent = '👁 Show';
    showBtn.style.cssText = `
      font-family: system-ui, sans-serif;
      font-size: 12px;
      font-weight: 500;
      padding: 5px 12px;
      border-radius: 6px;
      border: none;
      cursor: pointer;
      background: #6b7280;
      color: white;
      box-shadow: 0 1px 3px rgba(0,0,0,0.2);
    `;
    showBtn.onmouseover = () => showBtn.style.background = '#4b5563';
    showBtn.onmouseout = () => showBtn.style.background = '#6b7280';

    group.appendChild(aiBtn);
    group.appendChild(showBtn);

    // Insert after the answer wrapper (in the footer)
    answerWrapper.insertAdjacentElement('afterend', group);
    log('Buttons inserted into DOM');

    // Make buttons visible on hover of the footer area
    const footer = qEl.querySelector('.css-bx5sx3-footer');
    if (footer) {
      log('Found footer, attaching hover events');
      footer.style.position = 'relative';
      footer.addEventListener('mouseenter', () => {
        log('Footer mouseenter - showing buttons');
        group.style.opacity = '1';
      });
      footer.addEventListener('mouseleave', () => {
        log('Footer mouseleave - hiding buttons');
        group.style.opacity = '0';
      });
    } else {
      log('No footer found, buttons always visible');
      group.style.opacity = '1';
    }

    // Also show on button hover
    group.addEventListener('mouseenter', () => {
      group.style.opacity = '1';
    });

    log('Setting up AI button click handler');

    aiBtn.onclick = async () => {
      log('AI button clicked');
      if (aiBtn.disabled) return;
      const orig = aiBtn.textContent;
      aiBtn.disabled = true;
      aiBtn.textContent = '⏳';

      try {
        const data = extractQuestion();
        // Transform to Moodle-compatible format for the backend
        const moodleData = toMoodleFormat(data);
        log('Sending to background script (Moodle format):', moodleData);

        const reply = await browser.runtime.sendMessage({ action: 'solve', data: moodleData });
        log('Background reply:', reply);

        if (!reply?.ok) throw new Error(reply?.error || 'No response');

        const moodleResult = reply.data;
        if (moodleResult.error) throw new Error(moodleResult.error);

        // Transform Moodle response back to Classtime format for autoFill
        const result = fromMoodleResponse(moodleResult, data.type, data.options);
        log('Calling autoFill with transformed result');
        const filled = autoFill(data, result);
        log('AutoFill result:', filled);

        aiBtn.textContent = filled > 0 ? '✅' : '⚠️';
        setTimeout(() => { aiBtn.textContent = orig; aiBtn.disabled = false; }, 2000);
      } catch (err) {
        logError('AI button error:', err);
        aiBtn.textContent = '❌';
        setTimeout(() => { aiBtn.textContent = orig; aiBtn.disabled = false; }, 3000);
      }
    };

    showBtn.onclick = () => {
      log('Show button clicked');
      try {
        const data = extractQuestion();
        showModal(formatExtracted(data), data);
      } catch (err) {
        logError('Show button error:', err);
        showModal('Error: ' + err.message, null);
      }
    };

    log('Button injection complete');
  }

  // ========== INIT ==========

  log('=== Classtime AI Extension Loaded ===');
  log('URL:', window.location.href);

  const observer = new MutationObserver(() => {
    injectButtons();
    document.querySelectorAll('.ctq-sort-hint').forEach(b => {
      if (!document.querySelector('#sessionQuestion')?.contains(b)) b.remove();
    });
  });

  observer.observe(document.body, { childList: true, subtree: true });
  injectButtons();

  // Keyboard shortcut: Ctrl+Shift+A to toggle button visibility
  document.addEventListener('keydown', (e) => {
    if (e.ctrlKey && e.shiftKey && e.key === 'A') {
      const group = document.querySelector('.ctq-btn-group');
      if (group) {
        const current = group.style.opacity;
        group.style.opacity = current === '1' ? '0' : '1';
        log('Button visibility toggled via Ctrl+Shift+A');
      }
    }
  });

  log('=== Initialization complete ===');
})();
