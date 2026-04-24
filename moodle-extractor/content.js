(() => {
  'use strict';

  // Avoid double-injection if script re-runs
  if (window.__moodleExtractorLoaded) return;
  window.__moodleExtractorLoaded = true;

  const BTN_CLASS = 'mqe-extract-btn';
  const MODAL_ID = 'mqe-modal';

  // ---------- Helpers ----------

  // Collapse whitespace and trim, preserving no line breaks.
  const clean = (s) => (s || '').replace(/\s+/g, ' ').trim();

  // Turn a DOM subtree into readable plain text, keeping line breaks
  // for block-level stuff (p, br, h*, li).
  function nodeToText(root) {
    if (!root) return '';
    const clone = root.cloneNode(true);

    // Remove things we don't want in the text preview.
    clone.querySelectorAll(
      'script, style, .accesshide, .sr-only, input[type=hidden]'
    ).forEach((n) => n.remove());

    // Replace <br> with newlines.
    clone.querySelectorAll('br').forEach((br) =>
      br.replaceWith(document.createTextNode('\n'))
    );

    // Block elements should have surrounding newlines.
    const blocks = clone.querySelectorAll('p, div, h1, h2, h3, h4, h5, h6, li');
    blocks.forEach((el) => {
      el.prepend(document.createTextNode('\n'));
      el.append(document.createTextNode('\n'));
    });

    let text = clone.textContent || '';
    // Normalise whitespace line-by-line.
    return text
      .split('\n')
      .map((l) => l.replace(/\s+/g, ' ').trim())
      .filter((l) => l.length > 0)
      .join('\n');
  }

  // ---------- Extractors per question type ----------

  function extractCommon(qEl) {
    const qNo = clean(qEl.querySelector('.info .qno')?.textContent);
    const state = clean(qEl.querySelector('.info .state')?.textContent);
    const grade = clean(qEl.querySelector('.info .grade')?.textContent);
    const qtextEl = qEl.querySelector('.qtext');
    // For gapselect, the qtext contains the selects too, so we grab
    // only the non-select text later. Here we give a "header" version:
    // the italic intro + heading from the top.
    const headerClone = qtextEl ? qtextEl.cloneNode(true) : null;
    if (headerClone) {
      headerClone.querySelectorAll('.control.group1, .control.group2, .control.group3, .control.group4, .control.group5, .control.group6, .control.group7, .control.group8, .control[class*="group"], select').forEach((n) => n.remove());
    }
    const questionText = headerClone ? nodeToText(headerClone) : '';
    return { qNo, state, grade, questionText };
  }

  function extractKprime(qEl) {
    const { qNo, state, grade, questionText } = extractCommon(qEl);
    const table = qEl.querySelector('table.generaltable');

    // Extract column headers from <thead> (e.g. "Franchise", "Selbstbehalt")
    const headerCells = table?.querySelectorAll('thead th.header') || [];
    const headers = Array.from(headerCells)
      .map((th) => clean(th.textContent))
      .filter((h) => h);
    if (headers.length === 0) headers.push('richtig', 'falsch');

    const rows = table?.querySelectorAll('tbody tr') || [];
    const items = [];
    rows.forEach((tr) => {
      const optText = clean(tr.querySelector('.optiontext .optiontext, .optiontext')?.textContent);
      if (!optText) return;
      // Find which radio is checked / has data-initial-value
      const checkedRadio = tr.querySelector('input[type=radio][checked], input[type=radio]:checked');
      const initialRadio = tr.querySelector('input[type=radio][data-initial-value]');
      const selectedRadio = checkedRadio || initialRadio;
      let selectedHeader = null;
      if (selectedRadio) {
        // The column index corresponds to the header index
        const td = selectedRadio.closest('td');
        const allTds = Array.from(tr.querySelectorAll('td.kprimeresponsebutton'));
        const colIdx = allTds.indexOf(td);
        if (colIdx >= 0 && colIdx < headers.length) {
          selectedHeader = headers[colIdx];
        }
      }
      items.push({ text: optText, selected: selectedHeader });
    });
    return {
      type: 'K-Prime',
      qNo, state, grade, questionText,
      options: items,
      headers,
    };
  }

  function extractMultichoice(qEl) {
    const { qNo, state, grade, questionText } = extractCommon(qEl);
    const answerDivs = qEl.querySelectorAll('.answer > div');
    const items = [];
    answerDivs.forEach((d) => {
      const labelEl = d.querySelector('[data-region="answer-label"], label');
      const txt = clean(labelEl?.textContent || d.textContent);
      if (txt) {
        const isCorrect = d.classList.contains('correct');
        const isChecked = !!d.querySelector('input[checked], input:checked');
        items.push({ text: txt, correct: isCorrect, checked: isChecked });
      }
    });
    // Feedback "Die richtige Antwort ist: ..."
    const rightAnswer = clean(qEl.querySelector('.rightanswer')?.textContent);
    return {
      type: 'Multiple Choice',
      qNo, state, grade, questionText,
      options: items,
      rightAnswer,
    };
  }

  function extractGapselect(qEl) {
    const { qNo, state, grade } = extractCommon(qEl);
    const qtextEl = qEl.querySelector('.qtext');
    if (!qtextEl) {
      return { type: 'Gap Select', qNo, state, grade, questionText: '', gaps: [] };
    }

    // Build sentence with [Gap N] placeholders instead of the selects.
    const clone = qtextEl.cloneNode(true);
    clone.querySelectorAll('script, style, .accesshide, .sr-only').forEach((n) => n.remove());

    const gaps = [];
    const selects = Array.from(clone.querySelectorAll('select'));
    selects.forEach((sel, idx) => {
      const opts = Array.from(sel.querySelectorAll('option'))
        .map((o) => clean(o.textContent))
        .filter((t) => t && t !== '\u00A0');
      const chosen = clean(sel.querySelector('option[selected]')?.textContent);
      gaps.push({
        index: idx + 1,
        options: opts,
        selected: chosen && chosen !== '\u00A0' ? chosen : null,
      });
      // Replace the whole <span class="control ..."> wrapper if present,
      // otherwise the select itself, with a placeholder.
      const wrapper = sel.closest('span.control') || sel;
      wrapper.replaceWith(document.createTextNode(` [Lücke ${idx + 1}] `));
    });

    const questionText = nodeToText(clone);
    return {
      type: 'Lückentext (Gap Select)',
      qNo, state, grade, questionText,
      gaps,
    };
  }

  function extractMatch(qEl) {
    const { qNo, state, grade, questionText } = extractCommon(qEl);
    const table = qEl.querySelector('table.answer');
    if (!table) {
      return { type: 'Zuordnung (Match)', qNo, state, grade, questionText, items: [], matchOptions: [] };
    }

    const rows = table.querySelectorAll('tbody tr');
    const items = [];
    let matchOptions = [];

    rows.forEach((tr) => {
      const statementEl = tr.querySelector('td.text');
      const controlEl = tr.querySelector('td.control');
      const statement = nodeToText(statementEl);

      if (controlEl) {
        const select = controlEl.querySelector('select');
        if (select) {
          if (matchOptions.length === 0) {
            matchOptions = Array.from(select.querySelectorAll('option'))
              .map((o) => clean(o.textContent))
              .filter((t) => t && t !== '\u00A0');
          }
          const selectedOpt = select.querySelector('option[selected]');
          let selected = null;
          if (selectedOpt && selectedOpt.value !== '0') {
            selected = clean(selectedOpt.textContent);
          }
          items.push({ statement, selected });
        } else if (statement) {
          items.push({ statement, selected: null });
        }
      } else if (statement) {
        items.push({ statement, selected: null });
      }
    });

    // Filter out placeholder option (e.g. "Auswählen ...")
    const filteredOptions = matchOptions.filter((opt) =>
      !opt.toLowerCase().includes('auswählen')
    );

    return {
      type: 'Zuordnung (Match)',
      qNo, state, grade, questionText,
      items,
      matchOptions: filteredOptions,
    };
  }

  function extractQuestion(qEl) {
    if (qEl.classList.contains('kprime'))      return extractKprime(qEl);
    if (qEl.classList.contains('multichoice')) return extractMultichoice(qEl);
    if (qEl.classList.contains('gapselect'))   return extractGapselect(qEl);
    if (qEl.classList.contains('match'))       return extractMatch(qEl);

    // Fallback: try to grab the question text and any visible options.
    const { qNo, state, grade, questionText } = extractCommon(qEl);
    return {
      type: 'Unbekannt',
      qNo, state, grade, questionText,
      options: [],
    };
  }

  // ---------- Text formatting for the popup ----------

  function formatAsText(data) {
    const L = [];
    L.push(`Typ: ${data.type}`);
    if (data.qNo)   L.push(`Frage: ${data.qNo}`);
    if (data.state) L.push(`Status: ${data.state}`);
    if (data.grade) L.push(`Punkte: ${data.grade}`);
    L.push('');
    L.push('--- Fragetext ---');
    L.push(data.questionText || '(kein Text)');
    L.push('');

    if (data.type === 'K-Prime') {
      const hdr = data.headers.join(' / ');
      L.push(`--- Aussagen (${hdr}) ---`);
      data.options.forEach((opt, i) => {
        const sel = opt.selected ? `  [${opt.selected}]` : '';
        L.push(`${i + 1}. ${opt.text}${sel}`);
      });
    } else if (data.type === 'Multiple Choice') {
      L.push('--- Antwortoptionen ---');
      data.options.forEach((opt, i) => {
        const tags = [];
        if (opt.correct) tags.push('RICHTIG');
        if (opt.checked) tags.push('gewählt');
        const suffix = tags.length ? `  [${tags.join(', ')}]` : '';
        L.push(`${i + 1}. ${opt.text}${suffix}`);
      });
      if (data.rightAnswer) {
        L.push('');
        L.push(data.rightAnswer);
      }
    } else if (data.type.startsWith('Lückentext')) {
      L.push('--- Lücken ---');
      data.gaps.forEach((g) => {
        L.push(`Lücke ${g.index}${g.selected ? `  (gewählt: ${g.selected})` : ''}:`);
        g.options.forEach((o, i) => L.push(`   ${i + 1}) ${o}`));
      });
    } else if (data.type === 'Zuordnung (Match)') {
      L.push('--- Zuordnung ---');
      if (data.matchOptions && data.matchOptions.length > 0) {
        L.push('Verfügbare Optionen:');
        data.matchOptions.forEach((opt, i) => L.push(`   ${String.fromCharCode(65 + i)}) ${opt}`));
        L.push('');
      }
      L.push('Zuordnungen:');
      data.items.forEach((item, i) => {
        const sel = item.selected ? `  -> ${item.selected}` : '';
        L.push(`${i + 1}. ${item.statement}${sel}`);
      });
    } else if (data.options && data.options.length) {
      L.push('--- Optionen ---');
      data.options.forEach((o, i) => L.push(`${i + 1}. ${o}`));
    }

    return L.join('\n');
  }

  // ---------- AI answer formatting ----------

  function formatAnswer(questionData, aiResult) {
    const L = [];
    L.push('');
    L.push('=== AI-ANTWORT ===');
    L.push('');

    const type = questionData.type;

    if (type === 'K-Prime' && aiResult.answers) {
      const headers = questionData.headers || [];
      L.push(`(${headers.join(' / ')})`);
      L.push('');
      aiResult.answers.forEach((a, i) => {
        L.push(`${i + 1}. ${a.statement}`);
        L.push(`   Antwort: ${a.answer}`);
        L.push(`   Erklaerung: ${a.explanation}`);
        L.push('');
      });
    } else if (type === 'Multiple Choice' && aiResult.correctAnswer !== undefined) {
      const correctText = questionData.options[aiResult.correctAnswer - 1]?.text || '';
      L.push(`Richtige Antwort: ${aiResult.correctAnswer}. ${correctText}`);
      L.push(`Erklaerung: ${aiResult.explanation}`);
      L.push('');
      if (aiResult.alternatives && aiResult.alternatives.length > 0) {
        L.push('Warum die anderen falsch sind:');
        aiResult.alternatives.forEach((alt) => {
          L.push(`  ${alt.index}. ${alt.reason}`);
        });
      }
    } else if (type.startsWith('Lückentext') && aiResult.gaps) {
      aiResult.gaps.forEach((g) => {
        L.push(`Luecke ${g.gapNumber}: ${g.answer}`);
        L.push(`  Erklaerung: ${g.explanation}`);
      });
    } else if (type === 'Zuordnung (Match)' && aiResult.matches) {
      aiResult.matches.forEach((m, i) => {
        L.push(`${i + 1}. ${m.statement} -> ${m.answer}`);
        L.push(`   Erklaerung: ${m.explanation}`);
      });
    } else {
      L.push(JSON.stringify(aiResult, null, 2));
    }

    return L.join('\n');
  }

  // ---------- Auto-fill ----------

  function clickRadio(radio) {
    radio.checked = true;
    radio.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true }));
    radio.dispatchEvent(new Event('change', { bubbles: true }));
  }

  function setSelect(sel, opt) {
    opt.selected = true;
    sel.selectedIndex = Array.from(sel.options).indexOf(opt);
    sel.value = opt.value;
    console.log('[MQE] setSelect — value:', sel.value, 'selectedIndex:', sel.selectedIndex);
    ['change', 'input', 'click'].forEach((evt) => {
      sel.dispatchEvent(new Event(evt, { bubbles: true }));
    });
    const wrapper = sel.closest('.control') || sel.closest('span');
    if (wrapper) {
      wrapper.dispatchEvent(new Event('change', { bubbles: true }));
    }
  }

  function textMatches(haystack, needle) {
    const a = clean(haystack).toLowerCase();
    const b = needle.toLowerCase().trim();
    if (!a || !b) return false;
    return a === b || a.includes(b) || b.includes(a);
  }

  function autoFill(qEl, questionData, aiResult) {
    const type = questionData.type;
    let filled = 0;
    console.log('[MQE] autoFill — type:', type, 'aiResult:', JSON.stringify(aiResult));

    if (type === 'Multiple Choice' && aiResult.correctAnswer != null) {
      const answerDivs = qEl.querySelectorAll('.answer > div[class^="r"]');
      const idx = Number(aiResult.correctAnswer) - 1;
      console.log('[MQE] MC — divs:', answerDivs.length, 'idx:', idx);
      if (answerDivs[idx]) {
        const radio = answerDivs[idx].querySelector('input[type=radio]');
        console.log('[MQE] MC — radio found:', !!radio);
        if (radio) { clickRadio(radio); filled++; }
      }
    }

    else if (type === 'K-Prime' && aiResult.answers) {
      const table = qEl.querySelector('table.generaltable');
      const rows = table ? table.querySelectorAll('tbody tr') : [];
      const headers = questionData.headers || [];
      console.log('[MQE] KP — rows:', rows.length, 'headers:', headers);
      aiResult.answers.forEach((a, i) => {
        if (!rows[i]) return;
        const targetCol = headers.indexOf(a.answer);
        console.log('[MQE] KP — ans:', a.answer, 'col:', targetCol);
        if (targetCol < 0) return;
        const tds = rows[i].querySelectorAll('td.kprimeresponsebutton');
        if (tds[targetCol]) {
          const radio = tds[targetCol].querySelector('input[type=radio]');
          if (radio) { clickRadio(radio); filled++; }
        }
      });
    }

    else if (type.startsWith('Lückentext') && aiResult.gaps) {
      const qtextEl = qEl.querySelector('.qtext');
      const selects = qtextEl ? qtextEl.querySelectorAll('select') : [];
      console.log('[MQE] Gap — selects:', selects.length, 'gaps:', aiResult.gaps.length);
      aiResult.gaps.forEach((g) => {
        const sel = selects[Number(g.gapNumber) - 1];
        if (!sel) return;
        const opt = Array.from(sel.options).find((o) => textMatches(o.textContent, g.answer));
        console.log('[MQE] Gap — gap', g.gapNumber, 'answer:', g.answer, 'found:', !!opt);
        if (opt) { setSelect(sel, opt); filled++; }
      });
    }

    else if (type === 'Zuordnung (Match)' && aiResult.matches) {
      const rows = qEl.querySelectorAll('table.answer tbody tr');
      console.log('[MQE] Match — rows:', rows.length, 'matches:', aiResult.matches.length);
      aiResult.matches.forEach((m, i) => {
        if (!rows[i]) return;
        const sel = rows[i].querySelector('select');
        if (!sel) return;
        const opt = Array.from(sel.options).find((o) => textMatches(o.textContent, m.answer));
        console.log('[MQE] Match —', i, 'answer:', m.answer, 'found:', !!opt);
        if (opt) { setSelect(sel, opt); filled++; }
      });
    }

    else {
      console.log('[MQE] autoFill — NO BRANCH MATCHED. type:', type, 'keys:', Object.keys(aiResult));
    }

    return filled;
  }

  // ---------- Modal ----------

  function closeModal() {
    const m = document.getElementById(MODAL_ID);
    if (m) m.remove();
    document.removeEventListener('keydown', onKey);
  }

  function onKey(e) {
    if (e.key === 'Escape') closeModal();
  }

  function showModal(text, questionData, qEl) {
    closeModal();
    const overlay = document.createElement('div');
    overlay.id = MODAL_ID;
    overlay.className = 'mqe-modal-overlay';
    overlay.innerHTML = `
      <div class="mqe-modal-box" role="dialog" aria-modal="true" aria-label="Extrahierter Fragetext">
        <div class="mqe-modal-header">
          <span class="mqe-modal-title">Moodle Question Extractor</span>
          <div class="mqe-modal-actions">
            <button class="mqe-btn mqe-solve" type="button">AI Loesen</button>
            <button class="mqe-btn mqe-fill" type="button" style="display:none">Ausfuellen</button>
            <button class="mqe-btn mqe-copy" type="button">Kopieren</button>
            <button class="mqe-btn mqe-close" type="button" aria-label="Schliessen">&#10005;</button>
          </div>
        </div>
        <textarea class="mqe-modal-text" spellcheck="false" readonly></textarea>
        <div class="mqe-modal-footer">
          <span class="mqe-status"></span>
        </div>
      </div>
    `;
    document.body.appendChild(overlay);

    const ta = overlay.querySelector('.mqe-modal-text');
    ta.value = text;

    const statusEl = overlay.querySelector('.mqe-status');
    const setStatus = (msg) => {
      statusEl.textContent = msg;
      if (msg) setTimeout(() => { statusEl.textContent = ''; }, 3000);
    };

    // Store last AI result for the fill button
    let lastAiResult = null;

    // Auto-fill button — close modal first so selects can receive focus/events
    overlay.querySelector('.mqe-fill').addEventListener('click', () => {
      if (!qEl || !questionData || !lastAiResult) {
        setStatus('Fehler: keine Daten zum Ausfuellen.');
        return;
      }
      const savedResult = lastAiResult;
      const savedData = questionData;
      const savedQel = qEl;
      closeModal();
      // Small delay to let the DOM settle after modal removal
      setTimeout(() => {
        const count = autoFill(savedQel, savedData, savedResult);
        console.log('[MQE] autoFill result:', count, 'fields filled');
      }, 50);
    });

    // AI Solve button
    if (questionData) {
      overlay.querySelector('.mqe-solve').addEventListener('click', async () => {
        const solveBtn = overlay.querySelector('.mqe-solve');
        if (solveBtn.disabled) return;

        solveBtn.disabled = true;
        solveBtn.textContent = '...';
        setStatus('AI wird abgefragt...');

        try {
          const reply = await browser.runtime.sendMessage({
            action: 'solve',
            data: questionData,
          });

          if (!reply) {
            throw new Error('No response from background script');
          }

          if (!reply.ok) {
            throw new Error(reply.error || 'Unknown error');
          }

          const result = reply.data;

          if (result.error) {
            ta.value += '\n\nFehler: ' + result.error;
            if (result.raw) {
              ta.value += '\n\n--- Raw Response ---\n' + result.raw;
            }
            setStatus('Fehler bei der AI-Abfrage.');
          } else {
            const answerText = formatAnswer(questionData, result);
            ta.value += answerText;
            lastAiResult = result;
            if (qEl) overlay.querySelector('.mqe-fill').style.display = '';
            setStatus('AI-Antwort empfangen.');
          }
        } catch (err) {
          ta.value += '\n\nVerbindungsfehler: ' + (err.message || err);
          setStatus('Server nicht erreichbar.');
        } finally {
          solveBtn.disabled = false;
          solveBtn.textContent = 'AI Loesen';
        }
      });
    } else {
      // No question data — hide the solve button
      overlay.querySelector('.mqe-solve').style.display = 'none';
    }

    overlay.querySelector('.mqe-copy').addEventListener('click', async () => {
      try {
        await navigator.clipboard.writeText(ta.value);
        setStatus('In die Zwischenablage kopiert.');
      } catch (_e) {
        // Fallback if clipboard API is blocked.
        ta.select();
        const ok = document.execCommand && document.execCommand('copy');
        setStatus(ok ? 'Kopiert.' : 'Kopieren fehlgeschlagen - bitte manuell markieren.');
      }
    });
    overlay.querySelector('.mqe-close').addEventListener('click', closeModal);
    overlay.addEventListener('click', (e) => {
      if (e.target === overlay) closeModal();
    });
    document.addEventListener('keydown', onKey);

    // Auto-select the text so Ctrl+C works immediately.
    ta.focus();
    ta.select();
  }

  // ---------- Button injection ----------

  function addButtonTo(qEl) {
    const infoEl = qEl.querySelector(':scope > .info');
    if (!infoEl) return;
    if (infoEl.querySelector(`.${BTN_CLASS}`)) return; // already added

    const btn = document.createElement('button');
    btn.type = 'button';
    btn.className = BTN_CLASS;
    btn.title = 'Fragetext & Optionen extrahieren';
    btn.textContent = '📋 Extrahieren';

    btn.addEventListener('click', (e) => {
      e.preventDefault();
      e.stopPropagation();
      try {
        const data = extractQuestion(qEl);
        const text = formatAsText(data);
        showModal(text, data, qEl);
      } catch (err) {
        console.error('[MoodleExtractor] failed:', err);
        showModal('Fehler beim Extrahieren: ' + (err && err.message ? err.message : err), null, null);
      }
    });

    infoEl.appendChild(btn);

    // Inline AI button — solves & auto-fills without opening the modal
    const aiBtn = document.createElement('button');
    aiBtn.type = 'button';
    aiBtn.className = 'mqe-ai-btn';
    aiBtn.title = 'AI lösen & ausfüllen (ohne Popup)';
    aiBtn.textContent = '🤖 AI';

    aiBtn.addEventListener('click', async (e) => {
      e.preventDefault();
      e.stopPropagation();
      if (aiBtn.disabled) return;

      const originalText = aiBtn.textContent;
      aiBtn.disabled = true;
      aiBtn.textContent = '⏳';

      try {
        const questionData = extractQuestion(qEl);
        const reply = await browser.runtime.sendMessage({
          action: 'solve',
          data: questionData,
        });

        if (!reply || !reply.ok) {
          throw new Error((reply && reply.error) || 'Keine Antwort vom Server');
        }

        const result = reply.data;
        if (result.error) {
          throw new Error(result.error);
        }

        const filled = autoFill(qEl, questionData, result);
        aiBtn.textContent = filled > 0 ? '✅' : '⚠️';
        setTimeout(() => {
          aiBtn.textContent = originalText;
          aiBtn.disabled = false;
        }, 2000);
      } catch (err) {
        console.error('[MoodleExtractor] AI inline error:', err);
        aiBtn.textContent = '❌';
        aiBtn.title = err.message || 'Fehler';
        setTimeout(() => {
          aiBtn.textContent = originalText;
          aiBtn.title = 'AI lösen & ausfüllen (ohne Popup)';
          aiBtn.disabled = false;
        }, 3000);
      }
    });

    infoEl.appendChild(aiBtn);
  }

  function scan(root = document) {
    const questions = root.querySelectorAll(
      'div.que.kprime, div.que.multichoice, div.que.gapselect, div.que.match'
    );
    questions.forEach(addButtonTo);
  }

  // Initial scan.
  scan();

  // Observe DOM changes (Moodle sometimes re-renders questions after check).
  const observer = new MutationObserver((mutations) => {
    for (const m of mutations) {
      m.addedNodes.forEach((n) => {
        if (!(n instanceof Element)) return;
        if (n.matches?.('div.que.kprime, div.que.multichoice, div.que.gapselect, div.que.match')) {
          addButtonTo(n);
        } else {
          scan(n);
        }
      });
    }
  });
  observer.observe(document.body, { childList: true, subtree: true });
})();
