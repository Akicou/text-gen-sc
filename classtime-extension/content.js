(() => {
  'use strict';

  if (window.__classtimeAILoaded) return;
  window.__classtimeAILoaded = true;

  // ---------- Helpers ----------

  const clean = (s) => (s || '').replace(/\s+/g, ' ').trim();

  function getText(el) {
    return el ? clean(el.querySelector('[data-text="true"]')?.textContent || el.textContent) : '';
  }

  function getQuestionTitle() {
    return clean(document.querySelector('[data-testid="student-session-question-title"]')?.textContent);
  }

  function getQuestionDescription() {
    const el = document.querySelector('.styles__paragraphWithLinks-f74d2d');
    return el ? clean(el.textContent) : '';
  }

  // ---------- Type detection ----------

  function detectType(qEl) {
    if (qEl.querySelector('[data-testid="student-categorizer-answers-form"]')) return 'categorizer';
    if (qEl.querySelector('[data-testid="highlight-text-preview"]'))           return 'cloze';
    if (qEl.querySelector('.css-q3ryjf-sorterChoicesList'))                    return 'sorter';
    if (qEl.querySelector('[data-testid="student-answer-area"]'))              return 'opentext';
    const list = qEl.querySelector('[data-testid="questions-answers-list"]');
    if (list?.querySelector('input[type=radio]'))    return 'singlechoice';
    if (list?.querySelector('input[type=checkbox]')) return 'multichoice';
    return 'unknown';
  }

  // ---------- Extractors ----------

  function extractChoices(qEl) {
    return Array.from(qEl.querySelectorAll('[data-testid="choice-wrapper"]')).map((w, i) => ({
      index: i + 1,
      text: getText(w),
    }));
  }

  function extractMultichoice(qEl) {
    return {
      type: 'Multiple Choice',
      title: getQuestionTitle(),
      description: getQuestionDescription(),
      options: extractChoices(qEl),
    };
  }

  function extractSinglechoice(qEl) {
    return {
      type: 'Single Choice',
      title: getQuestionTitle(),
      description: getQuestionDescription(),
      options: extractChoices(qEl),
    };
  }

  function extractCategorizer(qEl) {
    const headers = Array.from(qEl.querySelectorAll('[data-testid="category-header-cell"]'))
      .map(th => getText(th));
    const rows = Array.from(qEl.querySelectorAll('[data-testid="question-answer-row"]'))
      .map(tr => getText(tr.querySelector('th')));
    return {
      type: 'Categorizer',
      title: getQuestionTitle(),
      description: getQuestionDescription(),
      categories: headers,
      items: rows,
    };
  }

  function extractOpentext(qEl) {
    const audioEl = qEl.querySelector('audio[src]');
    return {
      type: 'Open Text',
      title: getQuestionTitle(),
      description: getQuestionDescription(),
      audioSrc: audioEl?.src || null,
    };
  }

  function extractSorter(qEl) {
    const cards = Array.from(qEl.querySelectorAll('[data-testid="student-sorter-choice"]'));
    const items = cards.map((card, i) => ({
      currentPosition: Number(clean(card.querySelector('.css-1bzqaxw-choiceOrder')?.textContent)) || i + 1,
      text: getText(card.querySelector('[data-testid="student-sorter-choice-content"]') || card),
    }));
    return {
      type: 'Sorter',
      title: getQuestionTitle(),
      description: getQuestionDescription(),
      items,
    };
  }

  function extractCloze(qEl) {
    const preview = qEl.querySelector('[data-testid="highlight-text-preview"]');
    const groups = Array.from(preview?.querySelectorAll('[role="group"]') || []).map((g, i) => ({
      groupIndex: i,
      choices: Array.from(g.querySelectorAll('[data-testid="highlight-text-choice"]')).map(btn =>
        clean(btn.querySelector('[data-text="true"]')?.textContent || btn.textContent)
      ),
    }));
    return {
      type: 'Cloze',
      title: getQuestionTitle(),
      description: getQuestionDescription(),
      fullText: clean(preview?.textContent || ''),
      groups,
    };
  }

  function extractQuestion() {
    const qEl = document.querySelector('#sessionQuestion');
    if (!qEl) return { type: 'Unknown', title: '' };
    const type = detectType(qEl);
    switch (type) {
      case 'multichoice':   return extractMultichoice(qEl);
      case 'singlechoice':  return extractSinglechoice(qEl);
      case 'categorizer':   return extractCategorizer(qEl);
      case 'opentext':      return extractOpentext(qEl);
      case 'sorter':        return extractSorter(qEl);
      case 'cloze':         return extractCloze(qEl);
      default:              return { type: 'Unknown', title: getQuestionTitle() };
    }
  }

  // ---------- Auto-fill ----------

  function clickEl(el) {
    el.dispatchEvent(new MouseEvent('mousedown', { bubbles: true }));
    el.dispatchEvent(new MouseEvent('mouseup', { bubbles: true }));
    el.click();
  }

  function fillMultichoice(qEl, result) {
    const wrappers = qEl.querySelectorAll('[data-testid="choice-wrapper"]');
    const answers = result.correctAnswers || (result.correctAnswer != null ? [result.correctAnswer] : []);
    let filled = 0;
    answers.forEach((idx) => {
      const w = wrappers[Number(idx) - 1];
      if (!w) return;
      const cb = w.querySelector('input[type=checkbox]');
      if (cb && !cb.checked) {
        const label = w.querySelector('label') || cb;
        clickEl(label);
        filled++;
      }
    });
    return filled;
  }

  function fillSinglechoice(qEl, result) {
    const wrappers = qEl.querySelectorAll('[data-testid="choice-wrapper"]');
    const idx = Number(result.correctAnswer) - 1;
    const w = wrappers[idx];
    if (!w) return 0;
    const label = w.querySelector('label') || w.querySelector('input[type=radio]');
    if (label) { clickEl(label); return 1; }
    return 0;
  }

  function fillCategorizer(qEl, result) {
    if (!result.assignments) return 0;
    let filled = 0;
    result.assignments.forEach(({ item, category }) => {
      const target = `${clean(item)}, ${clean(category)}`.toLowerCase();
      qEl.querySelectorAll('input[type=checkbox][aria-label]').forEach((cb) => {
        if (clean(cb.getAttribute('aria-label')).toLowerCase() === target && !cb.checked) {
          const wrapper = cb.closest('[data-testid="question-answer-checkbox"]');
          if (wrapper) { clickEl(wrapper); filled++; }
        }
      });
    });
    return filled;
  }

  function fillOpentext(qEl, result) {
    if (!result.answer) return 0;
    const textarea = qEl.querySelector('[data-testid="student-answer-area"] textarea:not([aria-hidden="true"])');
    if (!textarea) return 0;
    const setter = Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, 'value').set;
    setter.call(textarea, result.answer);
    textarea.dispatchEvent(new Event('input', { bubbles: true }));
    textarea.dispatchEvent(new Event('change', { bubbles: true }));
    return 1;
  }

  function showSorterAnswer(qEl, result) {
    // Drag-and-drop auto-fill is not feasible; annotate each card with its correct position
    if (!result.order) return 0;
    const cards = qEl.querySelectorAll('[data-testid="student-sorter-choice"]');
    cards.forEach((card) => {
      const text = clean(card.querySelector('[data-text="true"]')?.textContent || '');
      const pos = result.order.findIndex((t) =>
        clean(t).toLowerCase().includes(text.toLowerCase()) ||
        text.toLowerCase().includes(clean(t).toLowerCase())
      );
      let badge = card.querySelector('.ctq-sort-badge');
      if (!badge) {
        badge = document.createElement('div');
        badge.className = 'ctq-sort-badge';
        card.appendChild(badge);
      }
      badge.textContent = pos >= 0 ? `→ pos ${pos + 1}` : '?';
    });
    return result.order.length;
  }

  function fillCloze(qEl, result) {
    if (!result.selections) return 0;
    const groups = qEl.querySelectorAll('[data-testid="highlight-text-preview"] [role="group"]');
    let filled = 0;
    result.selections.forEach(({ groupIndex, choice }) => {
      const group = groups[groupIndex];
      if (!group) return;
      group.querySelectorAll('[data-testid="highlight-text-choice"]').forEach((btn) => {
        const btnText = clean(btn.querySelector('[data-text="true"]')?.textContent || btn.textContent);
        if (btnText.toLowerCase() === clean(choice).toLowerCase()) {
          clickEl(btn);
          filled++;
        }
      });
    });
    return filled;
  }

  function autoFill(qEl, data, result) {
    switch (data.type) {
      case 'Multiple Choice': return fillMultichoice(qEl, result);
      case 'Single Choice':   return fillSinglechoice(qEl, result);
      case 'Categorizer':     return fillCategorizer(qEl, result);
      case 'Open Text':       return fillOpentext(qEl, result);
      case 'Sorter':          return showSorterAnswer(qEl, result);
      case 'Cloze':           return fillCloze(qEl, result);
      default:                return 0;
    }
  }

  // ---------- Format for modal ----------

  function formatExtracted(data) {
    const L = [];
    L.push(`Type: ${data.type}`);
    L.push(`Question: ${data.title}`);
    if (data.description) L.push(`Context: ${data.description}`);
    L.push('');
    if (data.options) {
      L.push('--- Options ---');
      data.options.forEach((o) => L.push(`${o.index}. ${o.text}`));
    }
    if (data.categories) {
      L.push('--- Categories ---');
      data.categories.forEach((c, i) => L.push(`${i + 1}. ${c}`));
      L.push('--- Items to assign ---');
      data.items.forEach((item, i) => L.push(`${i + 1}. ${item}`));
    }
    if (data.items && data.type === 'Sorter') {
      L.push('--- Current order ---');
      data.items.forEach((it) => L.push(`${it.currentPosition}. ${it.text}`));
    }
    if (data.groups) {
      L.push('--- Gaps ---');
      data.groups.forEach((g) => {
        L.push(`Gap ${g.groupIndex + 1}: ${g.choices.join(' / ')}`);
      });
    }
    if (data.audioSrc) L.push(`\nAudio: ${data.audioSrc}`);
    return L.join('\n');
  }

  function formatAIResult(data, result) {
    const L = ['\n=== AI ANSWER ===\n'];
    if (data.type === 'Multiple Choice') {
      const answers = result.correctAnswers || (result.correctAnswer ? [result.correctAnswer] : []);
      L.push(`Correct: ${answers.join(', ')}`);
      if (result.explanation) L.push(`Explanation: ${result.explanation}`);
    } else if (data.type === 'Single Choice') {
      L.push(`Correct: ${result.correctAnswer}`);
      if (result.explanation) L.push(`Explanation: ${result.explanation}`);
    } else if (data.type === 'Categorizer' && result.assignments) {
      result.assignments.forEach((a) => L.push(`${a.item} → ${a.category}`));
      if (result.explanation) L.push(`\nExplanation: ${result.explanation}`);
    } else if (data.type === 'Open Text') {
      L.push(`Answer: ${result.answer}`);
      if (result.explanation) L.push(`Explanation: ${result.explanation}`);
    } else if (data.type === 'Sorter' && result.order) {
      L.push('Correct order (1 = top):');
      result.order.forEach((t, i) => L.push(`${i + 1}. ${t}`));
      if (result.explanation) L.push(`\nExplanation: ${result.explanation}`);
    } else if (data.type === 'Cloze' && result.selections) {
      result.selections.forEach((s) => L.push(`Gap ${s.groupIndex + 1}: ${s.choice}`));
      if (result.explanation) L.push(`\nExplanation: ${result.explanation}`);
    } else {
      L.push(JSON.stringify(result, null, 2));
    }
    return L.join('\n');
  }

  // ---------- Modal ----------

  const MODAL_ID = 'ctq-modal';

  function closeModal() {
    const m = document.getElementById(MODAL_ID);
    if (m) m.remove();
    document.removeEventListener('keydown', onModalKey);
  }

  function onModalKey(e) {
    if (e.key === 'Escape') closeModal();
  }

  function showModal(text, data, qEl) {
    closeModal();
    const overlay = document.createElement('div');
    overlay.id = MODAL_ID;
    overlay.className = 'ctq-modal-overlay';
    overlay.innerHTML = `
      <div class="ctq-modal-box" role="dialog" aria-modal="true">
        <div class="ctq-modal-header">
          <span class="ctq-modal-title">Classtime AI Solver</span>
          <div class="ctq-modal-actions">
            <button class="ctq-btn ctq-modal-solve" type="button">AI Solve</button>
            <button class="ctq-btn ctq-modal-fill" type="button" style="display:none">Fill</button>
            <button class="ctq-btn ctq-modal-copy" type="button">Copy</button>
            <button class="ctq-btn ctq-modal-close" type="button">&#10005;</button>
          </div>
        </div>
        <textarea class="ctq-modal-text" spellcheck="false" readonly></textarea>
        <div class="ctq-modal-footer"><span class="ctq-status"></span></div>
      </div>
    `;
    document.body.appendChild(overlay);

    const ta = overlay.querySelector('.ctq-modal-text');
    ta.value = text;

    const statusEl = overlay.querySelector('.ctq-status');
    const setStatus = (msg) => {
      statusEl.textContent = msg;
      if (msg) setTimeout(() => { statusEl.textContent = ''; }, 3000);
    };

    let lastResult = null;

    overlay.querySelector('.ctq-modal-solve').addEventListener('click', async () => {
      const btn = overlay.querySelector('.ctq-modal-solve');
      if (btn.disabled) return;
      btn.disabled = true;
      btn.textContent = '...';
      setStatus('Asking AI...');
      try {
        const reply = await browser.runtime.sendMessage({ action: 'solve', data });
        if (!reply || !reply.ok) throw new Error((reply && reply.error) || 'No response');
        const result = reply.data;
        if (result.error) { ta.value += '\n\nError: ' + result.error; setStatus('AI error.'); return; }
        lastResult = result;
        ta.value += formatAIResult(data, result);
        if (qEl) overlay.querySelector('.ctq-modal-fill').style.display = '';
        setStatus('AI answer received.');
      } catch (err) {
        ta.value += '\n\nError: ' + (err.message || err);
        setStatus('Server not reachable.');
      } finally {
        btn.disabled = false;
        btn.textContent = 'AI Solve';
      }
    });

    overlay.querySelector('.ctq-modal-fill').addEventListener('click', () => {
      if (!qEl || !data || !lastResult) return;
      const savedResult = lastResult;
      closeModal();
      setTimeout(() => autoFill(qEl, data, savedResult), 50);
    });

    overlay.querySelector('.ctq-modal-copy').addEventListener('click', async () => {
      try {
        await navigator.clipboard.writeText(ta.value);
        setStatus('Copied.');
      } catch (_) {
        ta.select();
        document.execCommand && document.execCommand('copy');
        setStatus('Copied (fallback).');
      }
    });

    overlay.querySelector('.ctq-modal-close').addEventListener('click', closeModal);
    overlay.addEventListener('click', (e) => { if (e.target === overlay) closeModal(); });
    document.addEventListener('keydown', onModalKey);
    ta.focus();
    ta.select();
  }

  // ---------- Button injection ----------

  function injectButtons() {
    const qEl = document.querySelector('#sessionQuestion');
    if (!qEl) return;
    // Attach to the footer wrapper that contains the Submit button
    const footer = qEl.querySelector('.styles__answerButtonWrapper-a7f53e')?.closest('.css-bx5sx3-footer')
      || qEl.querySelector('[data-testid="answer-next-button"]')?.parentElement;
    if (!footer) return;
    if (footer.querySelector('.ctq-btn-group')) return;

    const group = document.createElement('div');
    group.className = 'ctq-btn-group';

    const aiBtn = document.createElement('button');
    aiBtn.type = 'button';
    aiBtn.className = 'ctq-btn ctq-inline-ai';
    aiBtn.title = 'AI solve & auto-fill (no popup)';
    aiBtn.textContent = '🤖 AI';

    const showBtn = document.createElement('button');
    showBtn.type = 'button';
    showBtn.className = 'ctq-btn ctq-inline-show';
    showBtn.title = 'Show question details / AI answer popup';
    showBtn.textContent = '👁 Show';

    group.appendChild(aiBtn);
    group.appendChild(showBtn);
    footer.appendChild(group);

    // Inline AI solve
    aiBtn.addEventListener('click', async () => {
      if (aiBtn.disabled) return;
      const orig = aiBtn.textContent;
      aiBtn.disabled = true;
      aiBtn.textContent = '⏳';
      try {
        const data = extractQuestion();
        const reply = await browser.runtime.sendMessage({ action: 'solve', data });
        if (!reply || !reply.ok) throw new Error((reply && reply.error) || 'No response');
        const result = reply.data;
        if (result.error) throw new Error(result.error);
        const filled = autoFill(qEl, data, result);
        aiBtn.textContent = filled > 0 ? '✅' : '⚠️';
        setTimeout(() => { aiBtn.textContent = orig; aiBtn.disabled = false; }, 2000);
      } catch (err) {
        console.error('[CTQ] AI error:', err);
        aiBtn.textContent = '❌';
        setTimeout(() => { aiBtn.textContent = orig; aiBtn.disabled = false; }, 3000);
      }
    });

    // Show popup
    showBtn.addEventListener('click', () => {
      try {
        const data = extractQuestion();
        showModal(formatExtracted(data), data, qEl);
      } catch (err) {
        showModal('Extract error: ' + (err.message || err), null, null);
      }
    });
  }

  // Re-inject whenever the question changes (SPA navigation)
  const observer = new MutationObserver(() => {
    injectButtons();
    // Clean stale sort badges when question changes
    document.querySelectorAll('.ctq-sort-badge').forEach((b) => {
      if (!document.querySelector('#sessionQuestion')?.contains(b)) b.remove();
    });
  });
  observer.observe(document.body, { childList: true, subtree: true });
  injectButtons();
})();
