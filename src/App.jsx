import { useEffect, useMemo, useRef, useState } from 'react';
import { listCatalog, listItems, postAction } from './api';

const blankItem = {
  name: '',
  quantity: '',
  category: '',
  notes: '',
  status: 'active',
  barcode: '',
  brand: ''
};

const navItems = [
  ['list', 'List'],
  ['add', 'Add'],
  ['ocr', 'Written list'],
  ['photo', 'Photo'],
  ['settings', 'Settings']
];

const categoryOptions = [
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

const addNewItemValue = '__add_new_item__';

const categoryAliases = {
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
  'Wine beer & spirits': 'Wine Beer & Spirits',
  Other: 'Other'
};

function normalizeCategory(category) {
  const trimmedCategory = String(category || '').trim();
  return categoryAliases[trimmedCategory] || trimmedCategory;
}

function categorySortIndex(category) {
  const normalizedCategory = normalizeCategory(category);
  const index = categoryOptions.indexOf(normalizedCategory);
  return index === -1 ? categoryOptions.length : index;
}

function normalizeKnownCategory(category) {
  const normalizedCategory = normalizeCategory(category);
  return categoryOptions.includes(normalizedCategory) ? normalizedCategory : 'Other';
}

function loadSetting(key, fallback = '') {
  return localStorage.getItem(key) || fallback;
}

function saveSetting(key, value) {
  localStorage.setItem(key, value || '');
}

function createTempId() {
  return `local-${Date.now()}-${Math.random().toString(36).slice(2)}`;
}

function loadItemCatalog() {
  try {
    return JSON.parse(localStorage.getItem('itemCatalog') || '{}');
  } catch {
    return {};
  }
}

function saveItemCatalog(catalog) {
  localStorage.setItem('itemCatalog', JSON.stringify(catalog));
}

function loadDeletedCatalogNames() {
  try {
    return JSON.parse(localStorage.getItem('deletedCatalogNames') || '{}');
  } catch {
    return {};
  }
}

function saveDeletedCatalogNames(deletedNames) {
  localStorage.setItem('deletedCatalogNames', JSON.stringify(deletedNames));
}

function addNameToCatalog(catalog, category, name) {
  const trimmedName = name.trim();
  const normalizedCategory = normalizeCategory(category);
  if (!normalizedCategory || !trimmedName) return catalog;

  const existing = catalog[normalizedCategory] || [];
  const alreadyExists = existing.some((itemName) => itemName.toLowerCase() === trimmedName.toLowerCase());
  if (alreadyExists) return catalog;

  return {
    ...catalog,
    [normalizedCategory]: [...existing, trimmedName].sort((a, b) => a.localeCompare(b))
  };
}

function removeNameFromCatalog(catalog, category, name) {
  const normalizedCategory = normalizeCategory(category);
  const normalizedName = name.trim().toLowerCase();
  return {
    ...catalog,
    [normalizedCategory]: (catalog[normalizedCategory] || []).filter((itemName) => itemName.toLowerCase() !== normalizedName)
  };
}

function loadCachedItems() {
  try {
    return JSON.parse(localStorage.getItem('cachedItems') || '[]').map(normalizeItem);
  } catch {
    return [];
  }
}

function loadPendingActions() {
  try {
    return JSON.parse(localStorage.getItem('pendingActions') || '[]');
  } catch {
    return [];
  }
}

function savePendingActions(actions) {
  localStorage.setItem('pendingActions', JSON.stringify(actions));
}

function createPendingAction(payload) {
  return {
    id: createTempId(),
    createdAt: new Date().toISOString(),
    payload
  };
}

function isConnectionError(error) {
  return !navigator.onLine || /Could not reach|Failed to fetch|NetworkError|Load failed/i.test(error.message);
}

function cleanOcrLine(line) {
  return line
    .replace(/^[\s*•\-–—]+/, '')
    .replace(/^\s*(\d+[\).:-]|\[[ xX]\]|\(\s*\)|\(\s*x\s*\))\s*/, '')
    .replace(/[;:,]+$/g, '')
    .replace(/\s+/g, ' ')
    .trim();
}

function getOcrErrorMessage(error) {
  if (/Unknown POST action/i.test(error.message)) {
    return 'AI OCR is not available yet. Paste the updated apps-script/Code.js into Apps Script and deploy a new Web App version.';
  }

  return error.message;
}

function resizeImageToDataUrl(file, maxDimension = 1400, quality = 0.82) {
  return new Promise((resolve, reject) => {
    const imageUrl = URL.createObjectURL(file);
    const image = new Image();

    image.onload = () => {
      const scale = Math.min(1, maxDimension / Math.max(image.width, image.height));
      const canvas = document.createElement('canvas');
      canvas.width = Math.max(1, Math.round(image.width * scale));
      canvas.height = Math.max(1, Math.round(image.height * scale));

      const context = canvas.getContext('2d');
      context.drawImage(image, 0, 0, canvas.width, canvas.height);
      URL.revokeObjectURL(imageUrl);
      resolve(canvas.toDataURL('image/jpeg', quality));
    };

    image.onerror = () => {
      URL.revokeObjectURL(imageUrl);
      reject(new Error('Could not load image for AI OCR.'));
    };

    image.src = imageUrl;
  });
}

function normalizeItem(item) {
  return {
    ...blankItem,
    ...item,
    status: item.status === 'checked' ? 'checked' : 'active'
  };
}

export default function App() {
  const [view, setView] = useState('list');
  const [cameraRequest, setCameraRequest] = useState(0);
  const [items, setItems] = useState(loadCachedItems);
  const [filter, setFilter] = useState('active');
  const [displayName, setDisplayName] = useState(() => loadSetting('displayName', ''));
  const [passcode, setPasscode] = useState(() => loadSetting('familyPasscode', ''));
  const [itemCatalog, setItemCatalog] = useState(loadItemCatalog);
  const [deletedCatalogNames, setDeletedCatalogNames] = useState(loadDeletedCatalogNames);
  const [pendingActions, setPendingActions] = useState(loadPendingActions);
  const [isOnline, setIsOnline] = useState(() => navigator.onLine);
  const [syncing, setSyncing] = useState(false);
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');

  async function refresh() {
    if (loadPendingActions().length && !syncing) {
      setError('Syncing saved offline changes before refreshing.');
      await syncPendingActions();
      return;
    }

    setError('');
    setLoading(true);
    try {
      const nextItems = await listItems(passcode);
      const normalized = nextItems.map(normalizeItem);
      setItems(normalized);
      localStorage.setItem('cachedItems', JSON.stringify(normalized));
    } catch (err) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    if (!passcode) return;
    if (loadPendingActions().length && navigator.onLine) {
      syncPendingActions();
    } else if (!loadPendingActions().length) {
      refresh();
    }
  }, []);

  useEffect(() => {
    function handleOnline() {
      setIsOnline(true);
      syncPendingActions();
    }

    function handleOffline() {
      setIsOnline(false);
    }

    window.addEventListener('online', handleOnline);
    window.addEventListener('offline', handleOffline);

    return () => {
      window.removeEventListener('online', handleOnline);
      window.removeEventListener('offline', handleOffline);
    };
  }, [pendingActions, passcode, syncing]);

  useEffect(() => {
    if (passcode && navigator.onLine && pendingActions.length) {
      syncPendingActions();
    }
  }, [passcode]);

  function saveItems(nextItems) {
    setItems(nextItems);
    localStorage.setItem('cachedItems', JSON.stringify(nextItems));
  }

  function saveQueue(nextActions) {
    setPendingActions(nextActions);
    savePendingActions(nextActions);
  }

  function queueAction(payload) {
    const nextActions = [...loadPendingActions(), createPendingAction(payload)];
    saveQueue(nextActions);
    setError('Saved on this device. It will sync when internet is available.');
  }

  async function sendQueuedPayload(payload) {
    if (payload.action === 'addItems') {
      try {
        return await postAction(payload, passcode);
      } catch (err) {
        if (!/Unknown POST action/i.test(err.message)) throw err;
        for (const item of payload.items || []) {
          await postAction({ action: 'addItem', item }, passcode);
        }
        return { ok: true };
      }
    }

    return postAction(payload, passcode);
  }

  async function syncPendingActions() {
    if (syncing || !passcode || !navigator.onLine) return;

    let queue = loadPendingActions();
    if (!queue.length) return;

    setSyncing(true);
    setError('');

    try {
      while (queue.length) {
        await sendQueuedPayload(queue[0].payload);
        queue = queue.slice(1);
        saveQueue(queue);
      }

      await refresh();
    } catch (err) {
      setError(isConnectionError(err) ? 'Still offline. Changes are saved on this device.' : `Sync stopped: ${err.message}`);
    } finally {
      setSyncing(false);
      setIsOnline(navigator.onLine);
    }
  }

  function rememberItemName(category, name) {
    const trimmedName = name.trim();
    const nextCatalog = addNameToCatalog(itemCatalog, category, trimmedName);
    const nextDeletedNames = removeNameFromCatalog(deletedCatalogNames, category, trimmedName);

    if (nextCatalog !== itemCatalog) {
      setItemCatalog(nextCatalog);
      saveItemCatalog(nextCatalog);
    }
    setDeletedCatalogNames(nextDeletedNames);
    saveDeletedCatalogNames(nextDeletedNames);
  }

  function deleteCatalogName(category, name) {
    const nextCatalog = removeNameFromCatalog(itemCatalog, category, name);
    const nextDeletedNames = addNameToCatalog(deletedCatalogNames, category, name);

    setItemCatalog(nextCatalog);
    saveItemCatalog(nextCatalog);
    setDeletedCatalogNames(nextDeletedNames);
    saveDeletedCatalogNames(nextDeletedNames);
  }

  async function importCatalogFromSheet() {
    setError('');
    setSaving(true);

    try {
      const rows = await listCatalog(passcode);
      let nextCatalog = itemCatalog;
      let nextDeletedNames = deletedCatalogNames;

      for (const row of rows) {
        if (!row.category || !row.name) continue;
        nextCatalog = addNameToCatalog(nextCatalog, row.category, row.name);
        nextDeletedNames = removeNameFromCatalog(nextDeletedNames, row.category, row.name);
      }

      setItemCatalog(nextCatalog);
      saveItemCatalog(nextCatalog);
      setDeletedCatalogNames(nextDeletedNames);
      saveDeletedCatalogNames(nextDeletedNames);
      return rows.length;
    } catch (err) {
      setError(err.message);
      return null;
    } finally {
      setSaving(false);
    }
  }

  function replaceItem(id, nextItem) {
    const normalized = normalizeItem(nextItem);
    saveItems(items.map((item) => (item.id === id ? normalized : item)));
  }

  async function addItem(item) {
    const name = item.name.trim();
    if (!name) {
      setError('Item name is required.');
      return false;
    }

    const optimisticItem = normalizeItem({
      ...blankItem,
      ...item,
      id: createTempId(),
      name,
      addedBy: displayName || 'Family',
      addedAt: new Date().toISOString(),
      updatedAt: new Date().toISOString()
    });
    const previousItems = items;

    rememberItemName(optimisticItem.category, optimisticItem.name);
    saveItems([...items, optimisticItem]);
    setView('list');
    setError('');
    setSaving(true);

    try {
      const data = await postAction(
        {
          action: 'addItem',
          item: {
            ...optimisticItem,
            id: optimisticItem.id
          }
        },
        passcode
      );
      saveItems([...previousItems, normalizeItem(data.item || optimisticItem)]);
      return true;
    } catch (err) {
      if (isConnectionError(err)) {
        queueAction({ action: 'addItem', item: optimisticItem });
        return true;
      }

      saveItems(previousItems);
      setError(err.message);
      return false;
    } finally {
      setSaving(false);
    }
  }

  async function toggleItem(item) {
    const previousItems = items;
    const nextStatus = item.status === 'checked' ? 'active' : 'checked';
    const optimisticItem = {
      ...item,
      status: nextStatus,
      updatedAt: new Date().toISOString(),
      checkedAt: nextStatus === 'checked' ? new Date().toISOString() : ''
    };

    saveItems(items.map((current) => (current.id === item.id ? normalizeItem(optimisticItem) : current)));
    setError('');
    setSaving(true);

    try {
      const data = await postAction(
        {
          action: 'toggleItem',
          id: item.id,
          status: nextStatus
        },
        passcode
      );
      replaceItem(item.id, data.item || optimisticItem);
      return true;
    } catch (err) {
      if (isConnectionError(err)) {
        queueAction({ action: 'toggleItem', id: item.id, status: nextStatus });
        return true;
      }

      saveItems(previousItems);
      setError(err.message);
      return false;
    } finally {
      setSaving(false);
    }
  }

  async function deleteItem(id) {
    const previousItems = items;

    saveItems(items.filter((item) => item.id !== id));
    setError('');
    setSaving(true);

    try {
      await postAction({ action: 'deleteItem', id }, passcode);
      return true;
    } catch (err) {
      if (isConnectionError(err)) {
        queueAction({ action: 'deleteItem', id });
        return true;
      }

      saveItems(previousItems);
      setError(err.message);
      return false;
    } finally {
      setSaving(false);
    }
  }

  async function updateItem(id, updates) {
    const previousItems = items;
    const existing = items.find((item) => item.id === id);
    if (!existing) return false;

    const optimisticItem = normalizeItem({
      ...existing,
      ...updates,
      updatedAt: new Date().toISOString()
    });

    rememberItemName(optimisticItem.category, optimisticItem.name);
    saveItems(items.map((item) => (item.id === id ? optimisticItem : item)));
    setError('');
    setSaving(true);

    try {
      const data = await postAction({ action: 'updateItem', id, updates }, passcode);
      replaceItem(id, data.item || optimisticItem);
      return true;
    } catch (err) {
      if (isConnectionError(err)) {
        queueAction({ action: 'updateItem', id, updates });
        return true;
      }

      saveItems(previousItems);
      setError(err.message);
      return false;
    } finally {
      setSaving(false);
    }
  }

  async function clearChecked() {
    const checked = items.filter((item) => item.status === 'checked');
    if (!checked.length) return;
    const previousItems = items;

    saveItems(items.filter((item) => item.status !== 'checked'));
    setError('');
    setSaving(true);
    try {
      for (const item of checked) {
        await postAction({ action: 'deleteItem', id: item.id }, passcode);
      }
    } catch (err) {
      if (isConnectionError(err)) {
        for (const item of checked) {
          queueAction({ action: 'deleteItem', id: item.id });
        }
        setSaving(false);
        return;
      }

      saveItems(previousItems);
      setError(err.message);
    } finally {
      setSaving(false);
    }
  }

  async function addManyItems(entries) {
    const now = new Date().toISOString();
    const optimisticItems = entries.map((entry) => {
      const name = typeof entry === 'string' ? entry : entry.name;
      const category = typeof entry === 'string' ? '' : normalizeKnownCategory(entry.category);

      return normalizeItem({
        ...blankItem,
        id: createTempId(),
        name,
        category,
        addedBy: displayName || 'Family',
        addedAt: now,
        updatedAt: now
      });
    });
    const itemsToAdd = optimisticItems;
    const previousItems = items;

    saveItems([...items, ...optimisticItems]);
    setView('list');
    setError('');
    setSaving(true);
    try {
      let savedItems;
      try {
        const data = await postAction({ action: 'addItems', items: itemsToAdd }, passcode);
        savedItems = data.items || optimisticItems;
      } catch (err) {
        if (!/Unknown POST action/i.test(err.message)) throw err;
        savedItems = [];
        for (const item of itemsToAdd) {
          const data = await postAction({ action: 'addItem', item }, passcode);
          savedItems.push(data.item || item);
        }
      }
      saveItems([...previousItems, ...savedItems.map(normalizeItem)]);
    } catch (err) {
      if (isConnectionError(err)) {
        queueAction({ action: 'addItems', items: optimisticItems });
        return;
      }

      saveItems(previousItems);
      setError(err.message);
    } finally {
      setSaving(false);
    }
  }

  const visibleItems = useMemo(() => {
    const filtered = items.filter((item) => filter === 'all' || item.status === filter);
    return [...filtered].sort((a, b) => {
      if (a.status !== b.status) return a.status === 'active' ? -1 : 1;
      return categorySortIndex(a.category) - categorySortIndex(b.category) || a.name.localeCompare(b.name);
    });
  }, [items, filter]);

  const itemNamesByCategory = useMemo(() => {
    const catalog = {};

    for (const [category, names] of Object.entries(itemCatalog)) {
      for (const itemName of names) {
        Object.assign(catalog, addNameToCatalog(catalog, category, itemName));
      }
    }

    for (const item of items) {
      if (item.category && item.name) {
        const nextCatalog = addNameToCatalog(catalog, normalizeCategory(item.category), item.name);
        Object.assign(catalog, nextCatalog);
      }
    }

    for (const [category, deletedNames] of Object.entries(deletedCatalogNames)) {
      for (const deletedName of deletedNames) {
        Object.assign(catalog, removeNameFromCatalog(catalog, category, deletedName));
      }
    }

    return catalog;
  }, [items, itemCatalog, deletedCatalogNames]);

  const pendingCount = pendingActions.length;
  const syncNotice = syncing
    ? `Syncing ${pendingCount || ''} saved change${pendingCount === 1 ? '' : 's'}...`
    : pendingCount
      ? `${pendingCount} change${pendingCount === 1 ? '' : 's'} saved on this device${isOnline ? '. Tap refresh to sync now.' : '. Waiting for internet.'}`
      : !isOnline
        ? 'Offline. Changes will be saved on this device.'
        : '';

  return (
    <div className="app-shell">
      <header className="app-header">
        <div>
          <p className="eyebrow">Family Groceries</p>
          <h1>{view === 'list' ? 'Shopping list' : navItems.find(([id]) => id === view)?.[1]}</h1>
        </div>
        <button className="icon-button" onClick={refresh} disabled={loading || saving || syncing} aria-label="Refresh list">
          ↻
        </button>
      </header>

      {error && <div className="alert">{error}</div>}
      {syncNotice && <div className="notice sync-notice">{syncNotice}</div>}
      {!passcode && (
        <div className="notice">
          Add the family passcode in Settings before syncing with Google Sheets.
        </div>
      )}

      <main>
        {view === 'list' && (
          <GroceryList
            items={visibleItems}
            totalItems={items}
            filter={filter}
            setFilter={setFilter}
            loading={loading}
            saving={saving}
            onToggle={toggleItem}
            onDelete={deleteItem}
            onUpdate={updateItem}
            onClearChecked={clearChecked}
            onAdd={() => setView('add')}
          />
        )}
        {view === 'add' && (
          <AddItemScreen
            itemNamesByCategory={itemNamesByCategory}
            onRememberItemName={rememberItemName}
            onDeleteCatalogName={deleteCatalogName}
            onAdd={addItem}
            saving={saving}
          />
        )}
        {view === 'ocr' && (
          <OcrScreen
            cameraRequest={cameraRequest}
            onAddMany={addManyItems}
            onAiOcr={(imageDataUrl) => postAction({ action: 'aiOcr', imageDataUrl }, passcode)}
            saving={saving}
          />
        )}
        {view === 'photo' && (
          <PhotoScreen
            cameraRequest={cameraRequest}
            onIdentifyPhoto={(imageDataUrl) => postAction({ action: 'identifyPhotoItem', imageDataUrl }, passcode)}
            onAdd={addItem}
            saving={saving}
          />
        )}
        {view === 'settings' && (
          <SettingsScreen
            displayName={displayName}
            passcode={passcode}
            saving={saving}
            onImportCatalog={importCatalogFromSheet}
            onSave={(next) => {
              setDisplayName(next.displayName);
              setPasscode(next.passcode);
              saveSetting('displayName', next.displayName);
              saveSetting('familyPasscode', next.passcode);
              setError('');
            }}
          />
        )}
      </main>

      <nav className="bottom-nav" aria-label="App screens">
        {navItems.map(([id, label]) => (
          <button
            key={id}
            className={view === id ? 'active' : ''}
            onClick={() => {
              setView(id);
              if (id === 'ocr' || id === 'photo') {
                setCameraRequest((current) => current + 1);
              }
            }}
          >
            {label}
          </button>
        ))}
      </nav>
    </div>
  );
}

function GroceryList({
  items,
  totalItems,
  filter,
  setFilter,
  loading,
  saving,
  onToggle,
  onDelete,
  onUpdate,
  onClearChecked,
  onAdd
}) {
  const counts = {
    active: totalItems.filter((item) => item.status === 'active').length,
    checked: totalItems.filter((item) => item.status === 'checked').length,
    all: totalItems.length
  };
  const groupedItems = groupItemsByCategory(items);

  return (
    <section className="screen">
      <div className="toolbar">
        {['active', 'checked', 'all'].map((status) => (
          <button key={status} className={filter === status ? 'selected' : ''} onClick={() => setFilter(status)}>
            {status} <span>{counts[status]}</span>
          </button>
        ))}
      </div>

      <div className="action-row">
        <button className="primary" onClick={onAdd}>Add item</button>
        <button onClick={onClearChecked} disabled={!counts.checked || saving}>Clear checked</button>
      </div>

      {loading && <p className="muted">Loading list...</p>}
      {!loading && !items.length && <EmptyList filter={filter} />}

      {groupedItems.map((group) => (
        <section className="category-group" key={group.category}>
          <h2>{group.category}</h2>
          <div className="list-stack">
            {group.items.map((item) => (
              <GroceryItem
                key={item.id}
                item={item}
                saving={saving}
                onToggle={onToggle}
                onDelete={onDelete}
                onUpdate={onUpdate}
              />
            ))}
          </div>
        </section>
      ))}
    </section>
  );
}

function groupItemsByCategory(items) {
  const groups = new Map();

  for (const item of items) {
    const category = normalizeCategory(item.category) || 'Other';
    if (!groups.has(category)) groups.set(category, []);
    groups.get(category).push(item);
  }

  return [...groups.entries()]
    .sort(([categoryA], [categoryB]) => {
      return categorySortIndex(categoryA) - categorySortIndex(categoryB) || categoryA.localeCompare(categoryB);
    })
    .map(([category, groupItems]) => ({ category, items: groupItems }));
}

function EmptyList({ filter }) {
  return (
    <div className="empty-state">
      <h2>No {filter === 'all' ? '' : filter} items</h2>
      <p>{filter === 'active' ? 'Add what you need for the next trip.' : 'Nothing to show here yet.'}</p>
    </div>
  );
}

function GroceryItem({ item, saving, onToggle, onDelete, onUpdate }) {
  const [editing, setEditing] = useState(false);
  const [draftName, setDraftName] = useState(item.name);
  const [draftCategory, setDraftCategory] = useState(normalizeKnownCategory(item.category));
  const [toggling, setToggling] = useState(false);

  useEffect(() => {
    if (!editing) {
      setDraftName(item.name);
      setDraftCategory(normalizeKnownCategory(item.category));
    }
  }, [editing, item.category, item.name]);

  async function handleSave(event) {
    event.preventDefault();

    const name = draftName.trim();
    if (!name) return;

    const ok = await onUpdate(item.id, {
      name,
      category: normalizeKnownCategory(draftCategory)
    });

    if (ok !== false) {
      setEditing(false);
    }
  }

  function handleCancel() {
    setDraftName(item.name);
    setDraftCategory(normalizeKnownCategory(item.category));
    setEditing(false);
  }

  if (editing) {
    return (
      <article className={`item-card editing ${item.status === 'checked' ? 'checked' : ''}`}>
        <form className="edit-item-form" onSubmit={handleSave}>
          <label>
            Item
            <input
              value={draftName}
              onChange={(event) => setDraftName(event.target.value)}
              autoFocus
            />
          </label>
          <label>
            Category
            <select
              value={draftCategory}
              onChange={(event) => setDraftCategory(event.target.value)}
            >
              {categoryOptions.map((category) => (
                <option key={category} value={category}>
                  {category}
                </option>
              ))}
            </select>
          </label>
          <div className="item-actions">
            <button type="button" onClick={handleCancel} disabled={saving}>
              Cancel
            </button>
            <button className="primary" type="submit" disabled={saving || !draftName.trim()}>
              Save
            </button>
          </div>
        </form>
      </article>
    );
  }

  return (
    <article
      className={`item-card ${item.status === 'checked' ? 'checked' : ''}`}
      onClick={() => setEditing(true)}
    >
      <button
        className="check-button"
        disabled={toggling}
        onClick={async (event) => {
          event.stopPropagation();
          setToggling(true);
          const ok = await onToggle(item);
          if (ok !== undefined) setToggling(false);
        }}
        aria-label={`Mark ${item.name}`}
      >
        {item.status === 'checked' || toggling ? '✓' : ''}
      </button>
      <button
        type="button"
        className="item-body item-edit-button"
        onClick={() => setEditing(true)}
        aria-label={`Edit ${item.name}`}
      >
        <h2>{item.name}</h2>
      </button>
      {toggling && (
        <p className="item-status">
          {item.status === 'checked' ? 'Unchecking item...' : 'Checking item...'}
        </p>
      )}
    </article>
  );
}

function AddItemScreen({ itemNamesByCategory, onRememberItemName, onDeleteCatalogName, onAdd, saving }) {
  const [category, setCategory] = useState(categoryOptions[0]);
  const [name, setName] = useState('');
  const [newName, setNewName] = useState('');
  const [addingNewName, setAddingNewName] = useState(false);
  const [categoryOpen, setCategoryOpen] = useState(true);
  const [nameOpen, setNameOpen] = useState(false);
  const nameOptions = itemNamesByCategory[category] || [];

  useEffect(() => {
    setName('');
    setNewName('');
    setAddingNewName(false);
  }, [category]);

  async function handleNameChange(value) {
    if (value !== addNewItemValue) {
      setName(value);
      setAddingNewName(false);
      if (value) {
        await onAdd({ ...blankItem, category, name: value });
      }
      return;
    }

    setName('');
    setAddingNewName(true);
  }

  async function handleSubmit(event) {
    event.preventDefault();

    const itemName = addingNewName ? newName.trim() : name.trim();
    if (!itemName) return;

    if (addingNewName) {
      onRememberItemName(category, itemName);
    }

    const ok = await onAdd({ ...blankItem, category, name: itemName });
    if (ok !== false) {
      setName('');
      setNewName('');
      setAddingNewName(false);
    }
  }

  return (
    <section className="screen">
      <form
        className="item-form"
        onSubmit={handleSubmit}
      >
        <label>
          Category
          <CategoryPicker
            category={category}
            open={categoryOpen}
            onOpenChange={setCategoryOpen}
            onSelectCategory={(nextCategory) => {
              setCategory(nextCategory);
              setCategoryOpen(false);
              setNameOpen(true);
            }}
          />
        </label>
        <label>
          Name
          <NamePicker
            disabled={saving}
            name={name}
            open={nameOpen}
            options={nameOptions}
            onOpenChange={setNameOpen}
            onAddNew={() => handleNameChange(addNewItemValue)}
            onDeleteName={(option) => onDeleteCatalogName(category, option)}
            onSelectName={handleNameChange}
          />
        </label>
        {addingNewName && (
          <div className="inline-add">
            <label>
              New item name
              <input
                value={newName}
                onChange={(event) => setNewName(event.target.value)}
                placeholder="Type item name"
                autoFocus
              />
            </label>
          </div>
        )}
        <button className="primary" type="submit" disabled={saving || !(addingNewName ? newName.trim() : name)}>
          {saving ? 'Adding...' : 'Add item'}
        </button>
      </form>
    </section>
  );
}

function PhotoItemPicker({ cameraRequest, saving, onIdentifyPhoto, onAdd }) {
  const inputRef = useRef(null);
  const [photoPreview, setPhotoPreview] = useState('');
  const [photoFile, setPhotoFile] = useState(null);
  const [photoStatus, setPhotoStatus] = useState('');
  const [guesses, setGuesses] = useState([]);
  const [identifying, setIdentifying] = useState(false);

  useEffect(() => {
    if (cameraRequest) {
      window.setTimeout(() => inputRef.current?.click(), 50);
    }
  }, [cameraRequest]);

  function normalizePhotoGuess(guess, index) {
    const name = String(typeof guess === 'string' ? guess : guess?.name || '').trim();
    const category = normalizeKnownCategory(typeof guess === 'string' ? '' : guess?.category);
    return {
      id: `${name}-${category}-${index}`,
      name,
      category
    };
  }

  function updateGuessCategory(id, category) {
    setGuesses((current) =>
      current.map((guess) =>
        guess.id === id ? { ...guess, category: normalizeKnownCategory(category) } : guess
      )
    );
  }

  async function handlePhoto(file) {
    if (!file) return;
    setPhotoFile(file);
    setPhotoPreview(URL.createObjectURL(file));
    setGuesses([]);
    setPhotoStatus('Photo ready. Tap Identify.');
  }

  async function identifyPhoto() {
    if (!photoFile) return;

    setIdentifying(true);
    setPhotoStatus('Identifying item...');
    setGuesses([]);

    try {
      const imageDataUrl = await resizeImageToDataUrl(photoFile);
      const result = await onIdentifyPhoto(imageDataUrl);
      const nextGuesses = (result.items || [])
        .map(normalizePhotoGuess)
        .filter((guess) => guess.name.length > 1);
      setGuesses(nextGuesses);
      setPhotoStatus(nextGuesses.length ? 'Tap the best match to add it.' : 'No item found. Try a clearer photo.');
    } catch (err) {
      setPhotoStatus(`Photo failed: ${getOcrErrorMessage(err)}`);
    } finally {
      setIdentifying(false);
    }
  }

  return (
    <div className="photo-panel">
      <input
        ref={inputRef}
        className="hidden-file-input"
        type="file"
        accept="image/*"
        capture="environment"
        onChange={(event) => handlePhoto(event.target.files?.[0])}
      />
      {!photoPreview && (
        <button type="button" className="primary" onClick={() => inputRef.current?.click()}>
          Open camera
        </button>
      )}
      {photoPreview && <img className="ocr-preview" src={photoPreview} alt="Item to identify" />}
      <button type="button" onClick={identifyPhoto} disabled={!photoFile || identifying || saving}>
        {identifying ? 'Identifying...' : 'Identify'}
      </button>
      {photoStatus && <p className="muted">{photoStatus}</p>}
      {guesses.length > 0 && (
        <div className="candidate-list">
          {guesses.map((guess) => (
            <div key={guess.id} className="photo-guess">
              <span className="candidate-text">{guess.name}</span>
              <select
                className="candidate-category-select"
                aria-label={`Category for ${guess.name}`}
                value={guess.category}
                onChange={(event) => updateGuessCategory(guess.id, event.target.value)}
              >
                {categoryOptions.map((category) => (
                  <option key={category} value={category}>
                    {category}
                  </option>
                ))}
              </select>
              <button
                type="button"
                className="guess-button"
                onClick={() => onAdd({ ...blankItem, name: guess.name, category: guess.category })}
                disabled={saving}
              >
                Add
              </button>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

function PhotoScreen({ cameraRequest, saving, onIdentifyPhoto, onAdd }) {
  return (
    <section className="screen">
      <PhotoItemPicker cameraRequest={cameraRequest} saving={saving} onIdentifyPhoto={onIdentifyPhoto} onAdd={onAdd} />
    </section>
  );
}

function CategoryPicker({ category, open, onOpenChange, onSelectCategory }) {
  return (
    <div className="name-picker">
      <button type="button" className="name-picker-button" onClick={() => onOpenChange(!open)}>
        {category}
      </button>
      {open && (
        <div className="name-picker-menu">
          {categoryOptions.map((option) => (
            <button
              key={option}
              type="button"
              className="name-picker-option"
              onClick={() => onSelectCategory(option)}
            >
              {option}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

function NamePicker({ disabled, name, open, options, onOpenChange, onAddNew, onDeleteName, onSelectName }) {
  const longPressTimer = useRef(null);
  const longPressHandled = useRef(false);

  function clearLongPress() {
    if (longPressTimer.current) {
      window.clearTimeout(longPressTimer.current);
      longPressTimer.current = null;
    }
  }

  function startLongPress(option) {
    clearLongPress();
    longPressHandled.current = false;
    longPressTimer.current = window.setTimeout(() => {
      longPressHandled.current = true;
      if (window.confirm(`Delete "${option}" from this app?`)) {
        onDeleteName(option);
      }
    }, 650);
  }

  async function selectOption(option) {
    if (longPressHandled.current) {
      longPressHandled.current = false;
      return;
    }

    onOpenChange(false);
    await onSelectName(option);
  }

  return (
    <div className="name-picker">
      <button
        type="button"
        className="name-picker-button"
        disabled={disabled}
        onClick={() => onOpenChange(!open)}
      >
        {name || 'Select item'}
      </button>
      {open && (
        <div className="name-picker-menu">
          <button
            type="button"
            className="name-picker-option add-option"
            onClick={() => {
              onOpenChange(false);
              onAddNew();
            }}
          >
            Add new item...
          </button>
          {options.length === 0 && <p className="name-picker-empty">No saved names yet</p>}
          {options.map((option) => (
            <button
              key={option}
              type="button"
              className="name-picker-option"
              onClick={() => selectOption(option)}
              onContextMenu={(event) => {
                event.preventDefault();
                if (window.confirm(`Delete "${option}" from this app?`)) {
                  onDeleteName(option);
                }
              }}
              onPointerCancel={clearLongPress}
              onPointerDown={() => startLongPress(option)}
              onPointerLeave={clearLongPress}
              onPointerUp={clearLongPress}
            >
              {option}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

function OcrScreen({ cameraRequest, onAddMany, onAiOcr, saving }) {
  const inputRef = useRef(null);
  const [image, setImage] = useState(null);
  const [imageFile, setImageFile] = useState(null);
  const [progress, setProgress] = useState('');
  const [candidates, setCandidates] = useState([]);
  const [aiLoading, setAiLoading] = useState(false);
  const selected = candidates
    .filter((candidate) => candidate.selected)
    .map((candidate) => ({ name: candidate.name, category: candidate.category }));

  useEffect(() => {
    if (cameraRequest) {
      window.setTimeout(() => inputRef.current?.click(), 50);
    }
  }, [cameraRequest]);

  function normalizeAiCandidate(candidate) {
    const name = String(typeof candidate === 'string' ? candidate : candidate?.name || '').trim();
    const category = normalizeKnownCategory(typeof candidate === 'string' ? '' : candidate?.category);
    return { name, category };
  }

  function setCandidateItems(items) {
    const seen = new Set();
    const nextCandidates = items
      .map(normalizeAiCandidate)
      .filter((candidate) => candidate.name.length > 1)
      .filter((candidate) => {
        const key = `${candidate.name.toLowerCase()}|${candidate.category}`;
        if (seen.has(key)) return false;
        seen.add(key);
        return true;
      })
      .map((candidate, index) => ({
        id: `${candidate.name}-${candidate.category}-${index}`,
        ...candidate,
        selected: true
      }));

    setCandidates(nextCandidates);
  }

  function handleImageSelected(file) {
    if (!file) return;
    setImageFile(file);
    setImage(URL.createObjectURL(file));
    setCandidates([]);
    setProgress('Photo ready. Tap Read with AI.');
  }

  async function runAiOcr() {
    if (!imageFile) return;

    setAiLoading(true);
    setProgress('Reading handwriting with AI...');

    try {
      const imageDataUrl = await resizeImageToDataUrl(imageFile);
      const result = await onAiOcr(imageDataUrl);
      const items = result.items || [];
      setCandidateItems(items);
      setProgress(items.length ? 'Review AI-detected items.' : 'AI did not find any grocery items.');
    } catch (err) {
      setProgress(`AI OCR failed: ${getOcrErrorMessage(err)}`);
    } finally {
      setAiLoading(false);
    }
  }

  function toggleCandidate(id) {
    setCandidates((current) =>
      current.map((candidate) =>
        candidate.id === id ? { ...candidate, selected: !candidate.selected } : candidate
      )
    );
  }

  function updateCandidateCategory(id, category) {
    setCandidates((current) =>
      current.map((candidate) =>
        candidate.id === id ? { ...candidate, category: normalizeKnownCategory(category) } : candidate
      )
    );
  }

  return (
    <section className="screen">
      <input
        ref={inputRef}
        className="hidden-file-input"
        type="file"
        accept="image/*"
        capture="environment"
        onChange={(event) => handleImageSelected(event.target.files?.[0])}
      />
      {!image && (
        <button type="button" className="primary" onClick={() => inputRef.current?.click()}>
          Open camera
        </button>
      )}
      {image && <img className="ocr-preview" src={image} alt="Selected grocery list" />}
      <button type="button" className="primary" onClick={runAiOcr} disabled={!imageFile || aiLoading}>
        {aiLoading ? 'Reading...' : 'Read with AI'}
      </button>
      {progress && <p className="muted">{progress}</p>}

      <div className="candidate-list">
        {candidates.map((candidate) => (
          <div key={candidate.id} className="candidate">
            <input
              type="checkbox"
              aria-label={`Add ${candidate.name}`}
              checked={candidate.selected}
              onChange={() => toggleCandidate(candidate.id)}
            />
            <span className="candidate-text">
              <span>{candidate.name}</span>
            </span>
            <select
              className="candidate-category-select"
              aria-label={`Category for ${candidate.name}`}
              value={candidate.category}
              onChange={(event) => updateCandidateCategory(candidate.id, event.target.value)}
            >
              {categoryOptions.map((category) => (
                <option key={category} value={category}>
                  {category}
                </option>
              ))}
            </select>
          </div>
        ))}
      </div>

      <button className="primary" disabled={!selected.length || saving} onClick={() => onAddMany(selected)}>
        Add selected items
      </button>
    </section>
  );
}

function SettingsScreen({ displayName, passcode, saving, onImportCatalog, onSave }) {
  const [form, setForm] = useState({ displayName, passcode });
  const [importMessage, setImportMessage] = useState('');

  async function handleImportCatalog() {
    setImportMessage('Importing catalog...');
    const count = await onImportCatalog();
    setImportMessage(count === null ? '' : `Imported ${count} catalog row${count === 1 ? '' : 's'} into this device.`);
  }

  return (
    <section className="screen">
      <form
        className="item-form"
        onSubmit={(event) => {
          event.preventDefault();
          onSave(form);
        }}
      >
        <label>
          Display name
          <input
            value={form.displayName}
            onChange={(event) => setForm({ ...form, displayName: event.target.value })}
            placeholder="Alex"
          />
        </label>
        <label>
          Family passcode
          <input
            value={form.passcode}
            onChange={(event) => setForm({ ...form, passcode: event.target.value })}
            type="password"
            placeholder="Shared passcode"
          />
        </label>
        <button className="primary" type="submit">Save settings</button>
      </form>
      <div className="settings-panel">
        <button type="button" onClick={handleImportCatalog} disabled={saving}>
          {saving ? 'Importing...' : 'Import catalog from Google Sheets'}
        </button>
        {importMessage && <p className="muted">{importMessage}</p>}
      </div>
      <p className="muted">
        The passcode is stored only in this browser and sent to your Apps Script Web App.
      </p>
    </section>
  );
}
