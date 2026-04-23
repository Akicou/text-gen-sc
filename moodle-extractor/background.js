const SOLVE_URL = 'http://localhost:5923/solve';

browser.runtime.onMessage.addListener((msg, _sender, sendResponse) => {
  if (msg.action !== 'solve') return;

  fetch(SOLVE_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(msg.data),
  })
    .then((res) => {
      if (!res.ok) throw new Error(`Server error: ${res.status}`);
      return res.json();
    })
    .then((result) => sendResponse({ ok: true, data: result }))
    .catch((err) => sendResponse({ ok: false, error: err.message || String(err) }));

  // Keep the message channel open for the async response.
  return true;
});
