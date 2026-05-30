import { useEffect, useMemo, useRef, useState } from 'react';
import { BrowserMultiFormatReader } from '@zxing/browser';
import Tesseract from 'tesseract.js';
import { listItems, postAction } from './api';

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
  ['barcode', 'Barcode'],
  ['ocr', 'OCR'],
  ['settings', 'Settings']
];

function loadSetting(key, fallback = '') {
  return localStorage.getItem(key) || fallback;
}

function saveSetting(key, value) {
  localStorage.setItem(key, value || '');
}

function cleanOcrLine(line) {
  return line
    .replace(/^[\s*•\-–—]+/, '')
    .replace(/^\s*(\d+[\).:-]|\[[ xX]\]|\(\s*\)|\(\s*x\s*\))\s*/, '')
    .replace(/[;:,]+$/g, '')
    .replace(/\s+/g, ' ')
    .trim();
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
  const [items, setItems] = useState([]);
  const [filter, setFilter] = useState('active');
  const [displayName, setDisplayName] = useState(() => loadSetting('displayName', ''));
  const [passcode, setPasscode] = useState(() => loadSetting('familyPasscode', ''));
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');

  async function refresh() {
    setError('');
    setLoading(true);
    try {
      const nextItems = await listItems(passcode);
      setItems(nextItems.map(normalizeItem));
    } catch (err) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    if (passcode) refresh();
  }, []);

  async function write(payload) {
    setError('');
    setSaving(true);
    try {
      await postAction(payload, passcode);
      await refresh();
      return true;
    } catch (err) {
      setError(err.message);
      return false;
    } finally {
      setSaving(false);
    }
  }

  async function addItem(item) {
    const name = item.name.trim();
    if (!name) {
      setError('Item name is required.');
      return false;
    }

    const ok = await write({
      action: 'addItem',
      item: {
        ...blankItem,
        ...item,
        name,
        addedBy: displayName || 'Family'
      }
    });

    if (ok) setView('list');
    return ok;
  }

  async function clearChecked() {
    const checked = items.filter((item) => item.status === 'checked');
    if (!checked.length) return;

    setError('');
    setSaving(true);
    try {
      for (const item of checked) {
        await postAction({ action: 'deleteItem', id: item.id }, passcode);
      }
      await refresh();
    } catch (err) {
      setError(err.message);
    } finally {
      setSaving(false);
    }
  }

  const visibleItems = useMemo(() => {
    const filtered = items.filter((item) => filter === 'all' || item.status === filter);
    return [...filtered].sort((a, b) => {
      if (a.status !== b.status) return a.status === 'active' ? -1 : 1;
      return (a.category || '').localeCompare(b.category || '') || a.name.localeCompare(b.name);
    });
  }, [items, filter]);

  return (
    <div className="app-shell">
      <header className="app-header">
        <div>
          <p className="eyebrow">Family Groceries</p>
          <h1>{view === 'list' ? 'Shopping list' : navItems.find(([id]) => id === view)?.[1]}</h1>
        </div>
        <button className="icon-button" onClick={refresh} disabled={loading || saving} aria-label="Refresh list">
          ↻
        </button>
      </header>

      {error && <div className="alert">{error}</div>}
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
            onToggle={(item) =>
              write({
                action: 'toggleItem',
                id: item.id,
                status: item.status === 'checked' ? 'active' : 'checked'
              })
            }
            onDelete={(id) => write({ action: 'deleteItem', id })}
            onUpdate={(id, updates) => write({ action: 'updateItem', id, updates })}
            onClearChecked={clearChecked}
            onAdd={() => setView('add')}
          />
        )}
        {view === 'add' && <AddItemScreen onAdd={addItem} saving={saving} />}
        {view === 'barcode' && <BarcodeScreen onAdd={addItem} saving={saving} />}
        {view === 'ocr' && <OcrScreen onAddMany={(candidates) => addMany(candidates, addItem)} saving={saving} />}
        {view === 'settings' && (
          <SettingsScreen
            displayName={displayName}
            passcode={passcode}
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
          <button key={id} className={view === id ? 'active' : ''} onClick={() => setView(id)}>
            {label}
          </button>
        ))}
      </nav>
    </div>
  );
}

async function addMany(candidates, addItem) {
  for (const candidate of candidates) {
    await addItem({ ...blankItem, name: candidate });
  }
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

      <div className="list-stack">
        {items.map((item) => (
          <GroceryItem key={item.id} item={item} onToggle={onToggle} onDelete={onDelete} onUpdate={onUpdate} />
        ))}
      </div>
    </section>
  );
}

function EmptyList({ filter }) {
  return (
    <div className="empty-state">
      <h2>No {filter === 'all' ? '' : filter} items</h2>
      <p>{filter === 'active' ? 'Add what you need for the next trip.' : 'Nothing to show here yet.'}</p>
    </div>
  );
}

function GroceryItem({ item, onToggle, onDelete, onUpdate }) {
  const [editing, setEditing] = useState(false);
  const [form, setForm] = useState(item);

  useEffect(() => setForm(item), [item]);

  if (editing) {
    return (
      <article className="item-card editing">
        <ItemForm
          initialItem={form}
          submitLabel="Save item"
          onSubmit={async (updates) => {
            const ok = await onUpdate(item.id, updates);
            if (ok !== false) setEditing(false);
          }}
        />
        <button className="quiet" onClick={() => setEditing(false)}>Cancel</button>
      </article>
    );
  }

  return (
    <article className={`item-card ${item.status === 'checked' ? 'checked' : ''}`}>
      <button className="check-button" onClick={() => onToggle(item)} aria-label={`Mark ${item.name}`}>
        {item.status === 'checked' ? '✓' : ''}
      </button>
      <div className="item-body">
        <div className="item-title-row">
          <h2>{item.name}</h2>
          {item.quantity && <span className="quantity">{item.quantity}</span>}
        </div>
        <div className="meta-row">
          {item.category && <span>{item.category}</span>}
          {item.brand && <span>{item.brand}</span>}
          {item.addedBy && <span>By {item.addedBy}</span>}
        </div>
        {item.notes && <p className="notes">{item.notes}</p>}
      </div>
      <div className="item-actions">
        <button onClick={() => setEditing(true)}>Edit</button>
        <button className="danger" onClick={() => onDelete(item.id)}>Delete</button>
      </div>
    </article>
  );
}

function AddItemScreen({ onAdd, saving }) {
  return (
    <section className="screen">
      <ItemForm initialItem={blankItem} submitLabel={saving ? 'Adding...' : 'Add item'} onSubmit={onAdd} />
    </section>
  );
}

function ItemForm({ initialItem, submitLabel, onSubmit }) {
  const [form, setForm] = useState(() => normalizeItem(initialItem));

  function update(field, value) {
    setForm((current) => ({ ...current, [field]: value }));
  }

  return (
    <form
      className="item-form"
      onSubmit={(event) => {
        event.preventDefault();
        onSubmit(form);
      }}
    >
      <label>
        Name
        <input value={form.name} onChange={(event) => update('name', event.target.value)} placeholder="Milk" required />
      </label>
      <div className="two-column">
        <label>
          Quantity
          <input value={form.quantity} onChange={(event) => update('quantity', event.target.value)} placeholder="2 bags" />
        </label>
        <label>
          Category
          <input value={form.category} onChange={(event) => update('category', event.target.value)} placeholder="Dairy" />
        </label>
      </div>
      <label>
        Notes
        <textarea value={form.notes} onChange={(event) => update('notes', event.target.value)} placeholder="Any details?" />
      </label>
      <button className="primary" type="submit">{submitLabel}</button>
    </form>
  );
}

function BarcodeScreen({ onAdd, saving }) {
  const videoRef = useRef(null);
  const controlsRef = useRef(null);
  const [scannerStatus, setScannerStatus] = useState('idle');
  const [barcode, setBarcode] = useState('');
  const [product, setProduct] = useState({ name: '', brand: '' });
  const [manualName, setManualName] = useState('');
  const [lookupMessage, setLookupMessage] = useState('');

  useEffect(() => () => stopScanner(), []);

  function stopScanner() {
    if (controlsRef.current) {
      controlsRef.current.stop();
      controlsRef.current = null;
    }
    setScannerStatus('idle');
  }

  async function startScanner() {
    setScannerStatus('starting');
    setLookupMessage('');
    const reader = new BrowserMultiFormatReader();

    try {
      controlsRef.current = await reader.decodeFromVideoDevice(null, videoRef.current, (result) => {
        if (!result) return;
        const code = result.getText();
        setBarcode(code);
        stopScanner();
        lookupBarcode(code);
      });
      setScannerStatus('scanning');
    } catch (err) {
      setLookupMessage(`Camera unavailable: ${err.message}`);
      setScannerStatus('idle');
    }
  }

  async function lookupBarcode(code) {
    setLookupMessage('Looking up product...');
    setProduct({ name: '', brand: '' });
    setManualName('');

    try {
      const response = await fetch(`https://world.openfoodfacts.org/api/v0/product/${encodeURIComponent(code)}.json`);
      const data = await response.json();
      if (data.status === 1 && data.product) {
        const name = data.product.product_name || '';
        const brand = data.product.brands || '';
        setProduct({ name, brand });
        setManualName(name);
        setLookupMessage(name ? 'Product found. Confirm before adding.' : 'Barcode found, but no product name was available.');
      } else {
        setLookupMessage('No product found. Enter a name to add it.');
      }
    } catch (err) {
      setLookupMessage(`Lookup failed: ${err.message}`);
    }
  }

  return (
    <section className="screen">
      <div className="scanner-box">
        <video ref={videoRef} muted playsInline />
      </div>
      <div className="action-row">
        <button className="primary" onClick={startScanner} disabled={scannerStatus !== 'idle'}>
          {scannerStatus === 'idle' ? 'Start camera' : 'Camera active'}
        </button>
        <button onClick={stopScanner}>Stop</button>
      </div>

      <label>
        Barcode
        <input value={barcode} onChange={(event) => setBarcode(event.target.value)} placeholder="Enter barcode manually" />
      </label>
      <button onClick={() => barcode && lookupBarcode(barcode)}>Look up barcode</button>

      {lookupMessage && <p className="muted">{lookupMessage}</p>}

      <div className="confirm-panel">
        <label>
          Product name
          <input value={manualName} onChange={(event) => setManualName(event.target.value)} placeholder="Product name" />
        </label>
        <label>
          Brand
          <input value={product.brand} onChange={(event) => setProduct({ ...product, brand: event.target.value })} placeholder="Brand" />
        </label>
        <button
          className="primary"
          disabled={!manualName.trim() || saving}
          onClick={() => onAdd({ ...blankItem, name: manualName, barcode, brand: product.brand })}
        >
          Add product
        </button>
      </div>
    </section>
  );
}

function OcrScreen({ onAddMany, saving }) {
  const [image, setImage] = useState(null);
  const [progress, setProgress] = useState('');
  const [rawText, setRawText] = useState('');
  const [candidates, setCandidates] = useState([]);
  const selected = candidates.filter((candidate) => candidate.selected).map((candidate) => candidate.name);

  async function runOcr(file) {
    if (!file) return;
    setImage(URL.createObjectURL(file));
    setRawText('');
    setCandidates([]);
    setProgress('Reading image...');

    try {
      const result = await Tesseract.recognize(file, 'eng', {
        logger: (message) => {
          if (message.status) setProgress(`${message.status} ${Math.round((message.progress || 0) * 100)}%`);
        }
      });
      const text = result.data.text || '';
      setRawText(text);
      setCandidates(
        text
          .split(/\r?\n/)
          .map(cleanOcrLine)
          .filter((line) => line.length > 1)
          .map((name, index) => ({ id: `${name}-${index}`, name, selected: true }))
      );
      setProgress('Review detected items.');
    } catch (err) {
      setProgress(`OCR failed: ${err.message}`);
    }
  }

  function toggleCandidate(id) {
    setCandidates((current) =>
      current.map((candidate) =>
        candidate.id === id ? { ...candidate, selected: !candidate.selected } : candidate
      )
    );
  }

  return (
    <section className="screen">
      <label className="file-picker">
        Upload or take a photo
        <input type="file" accept="image/*" capture="environment" onChange={(event) => runOcr(event.target.files?.[0])} />
      </label>
      {image && <img className="ocr-preview" src={image} alt="Selected grocery list" />}
      {progress && <p className="muted">{progress}</p>}
      {rawText && (
        <details>
          <summary>Extracted text</summary>
          <pre>{rawText}</pre>
        </details>
      )}

      <div className="candidate-list">
        {candidates.map((candidate) => (
          <label key={candidate.id} className="candidate">
            <input type="checkbox" checked={candidate.selected} onChange={() => toggleCandidate(candidate.id)} />
            <span>{candidate.name}</span>
          </label>
        ))}
      </div>

      <button className="primary" disabled={!selected.length || saving} onClick={() => onAddMany(selected)}>
        Add selected items
      </button>
    </section>
  );
}

function SettingsScreen({ displayName, passcode, onSave }) {
  const [form, setForm] = useState({ displayName, passcode });

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
      <p className="muted">
        The passcode is stored only in this browser and sent to your Apps Script Web App.
      </p>
    </section>
  );
}
