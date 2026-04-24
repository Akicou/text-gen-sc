const SOLVE_URL = 'http://localhost:5923/solve';

browser.runtime.onMessage.addListener((msg, _sender, sendResponse) => {
  if (msg.action !== 'solve') return;

  fetch(SOLVE_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(msg.data),
  })
    .then(async (res) => {
      const data = await res.json();
      if (!res.ok || data.error) {
        throw new Error(data.error || `Server error: ${res.status}`);
      }
      return data;
    })
    .then((result) => sendResponse({ ok: true, data: result }))
    .catch((err) => sendResponse({ ok: false, error: err.message || String(err) }));

  // Keep the message channel open for the async response.
  return true;
});
