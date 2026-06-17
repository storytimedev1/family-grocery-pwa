const SHEET_NAME = 'Items';
const CATALOG_SHEET_NAME = 'Catalog';
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

const CATEGORY_OPTIONS = [
  'Produce',
  'Deli',
  'Bread',
  'Meat',
  'Dairy Eggs & Cheese',
  'Frozen Foods',
  'Cereal',
  'Past Rice & Beans',
  'Oils & Dressings',
  'Canned Foods & Soups',
  'Snacks & Candy',
  'Beverages incl Coffee & Tea',
  'Sauces & Condiments',
  'Pet Care',
  'Spices & Seasoning',
  'Wine Beer & Spirits',
  'Household',
  'Personal Care',
  'Other'
];

const CATEGORY_ALIASES = {
  'Breads & Cereals': 'Bread',
  'Pet care': 'Pet Care',
  'Personal care & health': 'Personal Care',
  'Meats & deli': 'Meat',
  'Frozen foods': 'Frozen Foods',
  'Household items': 'Household',
  'Canned foods & soups': 'Canned Foods & Soups',
  'Snacks & candy': 'Snacks & Candy',
  'Beverages incl coffee & tea': 'Beverages incl Coffee & Tea',
  'Pasta rice & beans': 'Past Rice & Beans',
  'Oils & dressings': 'Oils & Dressings',
  'Sauces & condiments': 'Sauces & Condiments',
  'Spices & seasoning': 'Spices & Seasoning',
  'Wine beer & spirits': 'Wine Beer & Spirits'
};

function authorizeServices() {
  const props = PropertiesService.getScriptProperties();
  const spreadsheetId = props.getProperty('SPREADSHEET_ID');
  if (spreadsheetId) {
    SpreadsheetApp.openById(spreadsheetId).getName();
  }

  UrlFetchApp.fetch('https://openrouter.ai/api/v1/models', {
    muteHttpExceptions: true
  });

  return 'Authorization check complete.';
}

function doGet(e) {
  try {
    const params = e.parameter || {};
    if (params.action === 'listItems') {
      requirePasscode(params.passcode, true);
      return jsonResponse({ ok: true, items: listItems() });
    }

    if (params.action === 'listCatalog') {
      requirePasscode(params.passcode, true);
      return jsonResponse({ ok: true, catalog: listCatalog() });
    }

    return jsonResponse({ ok: false, error: 'Unknown GET action.' }, 400);
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

    if (body.action === 'addItems') {
      return jsonResponse({ ok: true, items: addItems(body.items || []) });
    }

    if (body.action === 'updateItem') {
      return jsonResponse({ ok: true, item: updateItem(body.id, body.updates || {}) });
    }

    if (body.action === 'deleteItem') {
      deleteItem(body.id);
      return jsonResponse({ ok: true });
    }

    if (body.action === 'clearChecked') {
      return jsonResponse({ ok: true, deleted: clearCheckedItems() });
    }

    if (body.action === 'toggleItem') {
      return jsonResponse({ ok: true, item: toggleItem(body.id, body.status) });
    }

    if (body.action === 'aiOcr') {
      return jsonResponse({ ok: true, items: aiOcr(body.imageDataUrl) });
    }

    if (body.action === 'identifyPhotoItem') {
      return jsonResponse({ ok: true, items: identifyPhotoItem(body.imageDataUrl) });
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

function listCatalog() {
  const props = PropertiesService.getScriptProperties();
  const spreadsheetId = props.getProperty('SPREADSHEET_ID');
  if (!spreadsheetId) {
    throw new Error('Set SPREADSHEET_ID in Apps Script project settings.');
  }

  const spreadsheet = SpreadsheetApp.openById(spreadsheetId);
  const sheet = spreadsheet.getSheetByName(CATALOG_SHEET_NAME);
  if (!sheet) return [];

  const values = sheet.getDataRange().getValues();
  if (values.length <= 1) return [];

  const headers = values[0].map((value) => String(value || '').trim().toLowerCase());
  const categoryIndex = headers.indexOf('category');
  const nameIndex = headers.indexOf('name');
  if (categoryIndex === -1 || nameIndex === -1) {
    throw new Error('Catalog tab must have category and name headers.');
  }

  return values.slice(1)
    .map((row) => ({
      category: String(row[categoryIndex] || '').trim(),
      name: String(row[nameIndex] || '').trim()
    }))
    .filter((row) => row.category && row.name);
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

function addItems(inputs) {
  if (!Array.isArray(inputs)) throw new Error('items must be an array.');

  const items = inputs.map((input) => buildNewItem(input || {}));
  if (!items.length) return [];

  const sheet = getItemsSheet();
  sheet
    .getRange(sheet.getLastRow() + 1, 1, items.length, HEADERS.length)
    .setValues(items.map((item) => HEADERS.map((header) => item[header] || '')));
  return items;
}

function buildNewItem(input) {
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

function clearCheckedItems() {
  const sheet = getItemsSheet();
  const values = sheet.getDataRange().getValues();
  let deleted = 0;

  for (let rowIndex = values.length - 1; rowIndex >= 1; rowIndex -= 1) {
    if (String(values[rowIndex][5]) === 'checked') {
      sheet.deleteRow(rowIndex + 1);
      deleted += 1;
    }
  }

  return deleted;
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

function aiOcr(imageDataUrl) {
  return openRouterVisionItems(imageDataUrl, [
    'Read this handwritten grocery list image.',
    'Return only JSON with this exact shape: {"items":[{"name":"item name","category":"category name"}]}.',
    'Include grocery/product names only.',
    'Do not include quantities, bullets, checkboxes, numbering, prices, or notes.',
    'Preserve trailing exclamation marks after an item name because they mark urgency, for example "milk!!".',
    'If exclamation marks appear beside or immediately after an item, keep the same number at the end of that item.',
    `Choose exactly one category for each item from this list: ${CATEGORY_OPTIONS.join(', ')}.`,
    'Use Other only when none of the listed categories is a reasonable fit.',
    'Examples: apples are Produce, turkey slices are Deli, chicken breast is Meat, milk is Dairy Eggs & Cheese, cereal is Cereal, dog food is Pet Care, shampoo is Personal Care.',
    'If a line has multiple obvious grocery items, split them into separate items.',
    'If uncertain, include the best short grocery-name guess.'
  ], 'OCR', true);
}

function identifyPhotoItem(imageDataUrl) {
  return openRouterVisionItems(imageDataUrl, [
    'Identify the grocery item shown in this image.',
    'Return only JSON with this exact shape: {"items":[{"name":"item name","category":"category name"}]}.',
    'Return one to three short grocery item guesses, most likely first.',
    'Use common grocery-list names such as "Apple", "Milk", "Cereal", "Dog food", or "Dish soap".',
    'If a brand or exact product name is clearly visible, include the product name, for example "Cheerios" or "Dawn dish soap".',
    `Choose exactly one category for each guess from this list: ${CATEGORY_OPTIONS.join(', ')}.`,
    'Use Other only when none of the listed categories is a reasonable fit.',
    'Examples: an apple is Produce, sliced ham is Deli, chicken is Meat, a milk carton is Dairy Eggs & Cheese, cereal is Cereal, laundry detergent is Household.',
    'Do not include explanations, quantities, or confidence scores.',
    'If the image is too unclear to identify a grocery item, return {"items":[]}.'
  ], 'photo identification', true);
}

function openRouterVisionItems(imageDataUrl, promptLines, taskName, includeCategories) {
  if (!imageDataUrl || !/^data:image\/(png|jpeg|jpg|webp);base64,/i.test(imageDataUrl)) {
    throw new Error(`Missing image data for ${taskName}.`);
  }

  const props = PropertiesService.getScriptProperties();
  const apiKey = props.getProperty('OPENROUTER_API_KEY');
  if (!apiKey) {
    throw new Error('Set OPENROUTER_API_KEY in Apps Script project settings.');
  }

  const model = props.getProperty('OPENROUTER_MODEL') || 'openai/gpt-4o-mini';
  const response = UrlFetchApp.fetch('https://openrouter.ai/api/v1/chat/completions', {
    method: 'post',
    contentType: 'application/json',
    muteHttpExceptions: true,
    headers: {
      Authorization: `Bearer ${apiKey}`,
      'HTTP-Referer': 'https://storytimedev1.github.io/family-grocery-pwa/',
      'X-Title': 'Family Grocery PWA'
    },
    payload: JSON.stringify({
      model,
      temperature: 0,
      max_tokens: 500,
      response_format: { type: 'json_object' },
      messages: [
        {
          role: 'user',
          content: [
            {
              type: 'text',
              text: promptLines.join(' ')
            },
            {
              type: 'image_url',
              image_url: {
                url: imageDataUrl
              }
            }
          ]
        }
      ]
    })
  });

  const statusCode = response.getResponseCode();
  const text = response.getContentText();
  if (statusCode < 200 || statusCode >= 300) {
    throw new Error(`OpenRouter request failed (${statusCode}): ${text.slice(0, 300)}`);
  }

  const data = JSON.parse(text);
  const content = data.choices &&
    data.choices[0] &&
    data.choices[0].message &&
    data.choices[0].message.content;
  if (!content) throw new Error(`OpenRouter returned no ${taskName} content.`);

  const parsed = parseAiJson(content);
  if (!Array.isArray(parsed.items)) {
    throw new Error(`OpenRouter ${taskName} response did not include an items array.`);
  }

  return parsed.items
    .map((item) => {
      if (includeCategories) {
        return {
          name: String(typeof item === 'string' ? item : item.name || '').trim(),
          category: normalizeKnownCategory(typeof item === 'string' ? '' : item.category)
        };
      }

      return String(typeof item === 'string' ? item : item.name || '').trim();
    })
    .filter((item) => {
      const name = includeCategories ? item.name : item;
      return name.length > 1;
    });
}

function normalizeKnownCategory(category) {
  const normalizedCategory = CATEGORY_ALIASES[String(category || '').trim()] || String(category || '').trim();
  return CATEGORY_OPTIONS.indexOf(normalizedCategory) === -1 ? 'Other' : normalizedCategory;
}

function parseAiJson(content) {
  try {
    return JSON.parse(content);
  } catch (error) {
    const match = String(content).match(/\{[\s\S]*\}/);
    if (!match) throw new Error('Could not parse AI OCR JSON.');
    return JSON.parse(match[0]);
  }
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
