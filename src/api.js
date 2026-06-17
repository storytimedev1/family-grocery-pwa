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
    const plainText = text
      .replace(/<script[\s\S]*?<\/script>/gi, ' ')
      .replace(/<style[\s\S]*?<\/style>/gi, ' ')
      .replace(/<[^>]+>/g, ' ')
      .replace(/\s+/g, ' ')
      .trim();

    if (/Script function not found:\s*do(Get|Post)/i.test(plainText)) {
      throw new Error(
        'The Apps Script Web App is not running this grocery backend. Copy apps-script/Code.js into Apps Script, save it, and deploy a new Web App version.'
      );
    }

    if (/^<!doctype html/i.test(text) || /^<html/i.test(text)) {
      throw new Error(
        plainText ||
          'The server returned an HTML page instead of grocery-list JSON. Check the Apps Script Web App URL in src/config.js.'
      );
    }

    throw new Error(plainText || text || 'The server returned an invalid response.');
  }

  if (!response.ok || data.ok === false) {
    throw new Error(data.error || 'Request failed.');
  }

  return data;
}

async function fetchAppsScript(input, init) {
  try {
    return await fetch(input, init);
  } catch (error) {
    if (error instanceof TypeError) {
      throw new Error(
        'Could not reach the Apps Script Web App. Check that the deployment is updated, has access set to Anyone, and matches src/config.js.'
      );
    }

    throw error;
  }
}

export async function listItems(passcode = '') {
  ensureConfigured();
  const url = new URL(APPS_SCRIPT_URL);
  url.searchParams.set('action', 'listItems');
  if (passcode) url.searchParams.set('passcode', passcode);

  const data = await parseJson(await fetchAppsScript(url.toString()));
  return data.items || [];
}

export async function listCatalog(passcode = '') {
  ensureConfigured();
  const url = new URL(APPS_SCRIPT_URL);
  url.searchParams.set('action', 'listCatalog');
  if (passcode) url.searchParams.set('passcode', passcode);

  const data = await parseJson(await fetchAppsScript(url.toString()));
  return data.catalog || [];
}

export async function postAction(payload, passcode = '') {
  ensureConfigured();
  const data = await parseJson(
    await fetchAppsScript(APPS_SCRIPT_URL, {
      method: 'POST',
      headers: {
        'Content-Type': 'text/plain;charset=utf-8'
      },
      body: JSON.stringify({ ...payload, passcode })
    })
  );

  return data;
}
