'use client';
import { useEffect, useMemo, useState } from 'react';

const API = (process.env.NEXT_PUBLIC_API_URL || 'http://localhost:4000/api').replace(/\/$/, '');
type Resource = { label: string; path: string; key: string; editable?: 'create' | 'patch' | 'both'; reports?: boolean };
const resources: Resource[] = [
  { label: 'Flights', path: '/admin/flights', key: 'flights', editable: 'both' },
  { label: 'Airports', path: '/admin/airports', key: 'airports', editable: 'both' },
  { label: 'Bookings', path: '/admin/bookings', key: 'bookings' },
  { label: 'Refunds', path: '/admin/refunds', key: 'refunds' },
  { label: 'Coupons', path: '/admin/coupons', key: 'coupons', editable: 'both' },
  { label: 'Promotions', path: '/admin/promotions', key: 'promotions', editable: 'create' },
  { label: 'Users', path: '/admin/users', key: 'users', editable: 'patch' },
  { label: 'Conversations', path: '/admin/conversations', key: 'conversations' },
  { label: 'Prompts', path: '/admin/prompts', key: 'prompts', editable: 'create' },
  { label: 'FAQ / AI answers', path: '/admin/faq', key: 'documents', editable: 'both' },
  { label: 'Support tickets', path: '/admin/support', key: 'tickets', editable: 'patch' },
  { label: 'Revenue report', path: '/admin/reports/revenue', key: 'daily' },
  { label: 'Popular routes', path: '/admin/reports/popular-routes', key: 'routes' },
  { label: 'Cancellation report', path: '/admin/reports/cancellations', key: 'daily' },
  { label: 'Audit log', path: '/admin/audit', key: 'events' },
];

export default function AdminPage() {
  const [token, setToken] = useState('');
  const [selected, setSelected] = useState(resources[0]);
  const [data, setData] = useState<any[]>([]);
  const [summary, setSummary] = useState<any>(null);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [busy, setBusy] = useState(false);
  const [recordId, setRecordId] = useState('');
  const [json, setJson] = useState('');
  const [query, setQuery] = useState('');

  useEffect(() => {
    try { const auth = JSON.parse(localStorage.getItem('skymate-auth') || '{}'); setToken(auth.token || ''); }
    catch { setToken(''); }
  }, []);

  async function request(path: string, init?: RequestInit) {
    const response = await fetch(`${API}${path}`, { ...init, headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}`, ...(init?.headers || {}) } });
    const result = response.headers.get('content-type')?.includes('application/json') ? await response.json() : await response.text();
    if (!response.ok) throw new Error(result?.error || 'Admin request failed.');
    return result;
  }

  async function load(resource = selected) {
    if (!token) return;
    setBusy(true); setError(''); setNotice('');
    try {
      const [overview, records] = await Promise.all([request('/admin/summary'), request(`${resource.path}${query ? `?q=${encodeURIComponent(query)}` : ''}`)]);
      setSummary(overview); setData(Array.isArray(records[resource.key]) ? records[resource.key] : []);
    } catch (e) { setError(e instanceof Error ? e.message : 'Could not load administration data.'); setData([]); }
    finally { setBusy(false); }
  }

  useEffect(() => { if (token) void load(selected); }, [token, selected, query]);

  async function save(method: 'POST' | 'PATCH') {
    setError(''); setNotice('');
    let value: unknown;
    try { value = JSON.parse(json); } catch { setError('Enter valid JSON for the selected record.'); return; }
    if (method === 'PATCH' && !recordId.trim()) { setError('Enter the record ID to update.'); return; }
    setBusy(true);
    try { await request(method === 'POST' ? selected.path : `${selected.path}/${encodeURIComponent(recordId.trim())}`, { method, body: JSON.stringify(value) }); setNotice(`${selected.label} saved.`); setJson(''); setRecordId(''); await load(selected); }
    catch (e) { setError(e instanceof Error ? e.message : 'Save failed.'); }
    finally { setBusy(false); }
  }

  async function downloadBookings() {
    setError('');
    try {
      const response = await fetch(`${API}/admin/reports/bookings.csv`, { headers: { Authorization: `Bearer ${token}` } });
      if (!response.ok) throw new Error('Could not download the bookings report.');
      const blob = await response.blob(); const url = URL.createObjectURL(blob); const link = document.createElement('a'); link.href = url; link.download = 'skymate-bookings.csv'; link.click(); URL.revokeObjectURL(url);
    } catch (e) { setError(e instanceof Error ? e.message : 'Report download failed.'); }
  }

  const countLabel = useMemo(() => `${data.length} record${data.length === 1 ? '' : 's'}`, [data.length]);
  if (!token) return <main className="admin-shell"><a href="/">← Back to SkyMate</a><h1>Operations portal</h1><p role="alert">Sign in with an admin account to manage SkyMate.</p></main>;

  return <main className="admin-shell">
    <header className="admin-header"><div><a href="/">← SkyMate</a><h1>Operations portal</h1><p>Manage inventory, reservations, customer service and AI reference content.</p></div><button onClick={() => void load() } disabled={busy}>{busy ? 'Loading…' : 'Refresh'}</button></header>
    {summary && <section className="admin-kpis">{Object.entries(summary).filter(([key]) => key !== 'demo').map(([key, value]) => <article key={key}><small>{key.replace(/[A-Z]/g, m => ` ${m}`).toUpperCase()}</small><strong>{String(value)}</strong></article>)}</section>}
    <div className="admin-layout">
      <nav className="admin-nav" aria-label="Administration sections">{resources.map(item => <button key={item.path} className={selected.path === item.path ? 'active' : ''} onClick={() => { setSelected(item); setRecordId(''); setJson(''); }}>{item.label}</button>)}<button onClick={() => void downloadBookings()}>Download bookings CSV ↓</button></nav>
      <section className="admin-panel"><div className="admin-panel-heading"><div><h2>{selected.label}</h2><p>{countLabel}</p></div><label>Filter<input value={query} onChange={e => setQuery(e.target.value)} placeholder="Search records" /></label></div>
        {selected.editable && <details className="admin-editor"><summary>Create or update record</summary><p>Use the documented API field names as JSON. For updates, enter the record ID or code.</p><label>Record ID / code<input value={recordId} onChange={e => setRecordId(e.target.value)} placeholder="Required for updates" /></label><label>Record data<textarea rows={7} value={json} onChange={e => setJson(e.target.value)} placeholder={'{\n  "...": "..."\n}'} /></label><div className="admin-actions">{['create','both'].includes(selected.editable) && <button disabled={busy} onClick={() => void save('POST')}>Create</button>}{['patch','both'].includes(selected.editable) && <button disabled={busy} onClick={() => void save('PATCH')}>Update</button>}</div></details>}
        {error && <p className="admin-error" role="alert">{error}</p>}{notice && <p className="admin-notice" role="status">{notice}</p>}
        <div className="admin-records">{data.map((row, index) => <details className="admin-record" key={row.id ?? row.booking_ref ?? row.code ?? row.session_id ?? index}><summary><strong>{row.flight_no || row.booking_ref || row.code || row.city || row.email || row.name || row.session_id || row.title || row.status || `Record ${index + 1}`}</strong><span>{row.airline || row.status || row.created_at || row.version || ''}</span></summary><pre>{JSON.stringify(row, null, 2)}</pre></details>)}{!busy && data.length === 0 && <p className="admin-empty">No records found.</p>}</div>
      </section>
    </div>
  </main>;
}
