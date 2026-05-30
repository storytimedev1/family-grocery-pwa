import { APPS_SCRIPT_URL } from './config';

function ensureConfigured() {
  if (!APPS_SCRIPT_URL || APPS_SCRIPT_URL.includes('PASTE_YOUR')) {
    throw new Error('Set APPS_SCRIPT_URL in src/config.js before syncing.');
  }
}

async function parseJson(response) {
  const text = await response.text();
  let data;

  try {
    data = text ? JSON.parse(text) : {};
  } catch {
    throw new Error(text || 'The server returned an invalid response.');
  }

  if (!response.ok || data.ok === false) {
    throw new Error(data.error || 'Request failed.');
  }

  return data;
}

export async function listItems(passcode = '') {
  ensureConfigured();
  const url = new URL(APPS_SCRIPT_URL);
  url.searchParams.set('action', 'listItems');
  if (passcode) url.searchParams.set('passcode', passcode);

  const data = await parseJson(await fetch(url.toString()));
  return data.items || [];
}

export async function postAction(payload, passcode = '') {
  ensureConfigured();
  const data = await parseJson(
    await fetch(APPS_SCRIPT_URL, {
      method: 'POST',
      headers: {
        'Content-Type': 'text/plain;charset=utf-8'
      },
      body: JSON.stringify({ ...payload, passcode })
    })
  );

  return data;
}
