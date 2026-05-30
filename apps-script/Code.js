const SHEET_NAME = 'Items';
const HEADERS = [
  'id',
  'name',
  'quantity',
  'category',
  'notes',
  'status',
  'barcode',
  'brand',
  'addedBy',
  'addedAt',
  'updatedAt',
  'checkedAt'
];

function doGet(e) {
  try {
    const params = e.parameter || {};
    if (params.action !== 'listItems') {
      return jsonResponse({ ok: false, error: 'Unknown GET action.' }, 400);
    }

    requirePasscode(params.passcode, true);
    return jsonResponse({ ok: true, items: listItems() });
  } catch (error) {
    return jsonResponse({ ok: false, error: error.message }, 400);
  }
}

function doPost(e) {
  try {
    const body = parseBody(e);
    requirePasscode(body.passcode, false);

    if (body.action === 'addItem') {
      return jsonResponse({ ok: true, item: addItem(body.item || {}) });
    }

    if (body.action === 'updateItem') {
      return jsonResponse({ ok: true, item: updateItem(body.id, body.updates || {}) });
    }

    if (body.action === 'deleteItem') {
      deleteItem(body.id);
      return jsonResponse({ ok: true });
    }

    if (body.action === 'toggleItem') {
      return jsonResponse({ ok: true, item: toggleItem(body.id, body.status) });
    }

    return jsonResponse({ ok: false, error: 'Unknown POST action.' }, 400);
  } catch (error) {
    return jsonResponse({ ok: false, error: error.message }, 400);
  }
}

function listItems() {
  const sheet = getItemsSheet();
  const values = sheet.getDataRange().getValues();
  if (values.length <= 1) return [];

  return values.slice(1)
    .filter((row) => row.some((value) => value !== ''))
    .map(rowToItem);
}

function addItem(input) {
  const now = new Date().toISOString();
  const item = sanitizeItem({
    ...input,
    id: input.id || Utilities.getUuid(),
    status: input.status === 'checked' ? 'checked' : 'active',
    addedAt: input.addedAt || now,
    updatedAt: now,
    checkedAt: input.status === 'checked' ? now : ''
  });

  if (!item.name) throw new Error('Item name is required.');

  const sheet = getItemsSheet();
  sheet.appendRow(HEADERS.map((header) => item[header] || ''));
  return item;
}

function updateItem(id, updates) {
  if (!id) throw new Error('Missing item id.');

  const found = findItemRow(id);
  const current = rowToItem(found.values);
  const now = new Date().toISOString();
  const next = sanitizeItem({
    ...current,
    ...pickAllowedUpdates(updates),
    id,
    updatedAt: now
  });

  if (!next.name) throw new Error('Item name is required.');

  found.sheet.getRange(found.rowNumber, 1, 1, HEADERS.length).setValues([
    HEADERS.map((header) => next[header] || '')
  ]);
  return next;
}

function deleteItem(id) {
  if (!id) throw new Error('Missing item id.');

  const found = findItemRow(id);
  found.sheet.deleteRow(found.rowNumber);
}

function toggleItem(id, status) {
  if (status !== 'active' && status !== 'checked') {
    throw new Error('Status must be active or checked.');
  }

  return updateItem(id, {
    status,
    checkedAt: status === 'checked' ? new Date().toISOString() : ''
  });
}

function getItemsSheet() {
  const props = PropertiesService.getScriptProperties();
  const spreadsheetId = props.getProperty('SPREADSHEET_ID');
  if (!spreadsheetId) {
    throw new Error('Set SPREADSHEET_ID in Apps Script project settings.');
  }

  const spreadsheet = SpreadsheetApp.openById(spreadsheetId);
  let sheet = spreadsheet.getSheetByName(SHEET_NAME);
  if (!sheet) sheet = spreadsheet.insertSheet(SHEET_NAME);

  ensureHeaders(sheet);
  return sheet;
}

function ensureHeaders(sheet) {
  const firstRow = sheet.getRange(1, 1, 1, HEADERS.length).getValues()[0];
  const hasHeaders = HEADERS.every((header, index) => firstRow[index] === header);
  if (!hasHeaders) {
    sheet.getRange(1, 1, 1, HEADERS.length).setValues([HEADERS]);
    sheet.setFrozenRows(1);
  }
}

function findItemRow(id) {
  const sheet = getItemsSheet();
  const values = sheet.getDataRange().getValues();

  for (let index = 1; index < values.length; index += 1) {
    if (String(values[index][0]) === String(id)) {
      return {
        sheet,
        rowNumber: index + 1,
        values: values[index]
      };
    }
  }

  throw new Error('Item not found.');
}

function rowToItem(row) {
  return HEADERS.reduce((item, header, index) => {
    const value = row[index];
    item[header] = value instanceof Date ? value.toISOString() : String(value || '');
    return item;
  }, {});
}

function sanitizeItem(input) {
  const item = {};
  HEADERS.forEach((header) => {
    item[header] = String(input[header] || '').trim();
  });
  item.status = item.status === 'checked' ? 'checked' : 'active';
  return item;
}

function pickAllowedUpdates(updates) {
  const allowed = ['name', 'quantity', 'category', 'notes', 'status', 'barcode', 'brand', 'checkedAt'];
  return allowed.reduce((picked, key) => {
    if (Object.prototype.hasOwnProperty.call(updates, key)) {
      picked[key] = updates[key];
    }
    return picked;
  }, {});
}

function parseBody(e) {
  if (!e || !e.postData || !e.postData.contents) {
    throw new Error('Missing request body.');
  }

  try {
    return JSON.parse(e.postData.contents);
  } catch (error) {
    throw new Error('Request body must be JSON.');
  }
}

function requirePasscode(passcode, isRead) {
  const props = PropertiesService.getScriptProperties();
  const expected = props.getProperty('FAMILY_PASSCODE') || '';
  const requireReads = props.getProperty('REQUIRE_PASSCODE_FOR_READS') === 'true';

  if (!expected) return;
  if (isRead && !requireReads) return;
  if (String(passcode || '') !== expected) {
    throw new Error('Invalid family passcode.');
  }
}

function jsonResponse(payload) {
  return ContentService
    .createTextOutput(JSON.stringify(payload))
    .setMimeType(ContentService.MimeType.JSON);
}
