import React, { useEffect, useState } from 'react'
import { createRoot } from 'react-dom/client'
import './style.css'

const blank = { passenger: '', flight: '', origin: '', destination: '', departure: '', status: 'booked' }
const fields = ['passenger', 'flight', 'origin', 'destination', 'departure']
function localDateTime(timestamp) {
  const date = new Date(timestamp)
  const pad = number => String(number).padStart(2, '0')
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}T${pad(date.getHours())}:${pad(date.getMinutes())}`
}

function App() {
  const [phase, setPhase] = useState('discovering')
  const [token, setToken] = useState('')
  const [credentials, setCredentials] = useState({ username: '', password: '' })
  const [tickets, setTickets] = useState([])
  const [form, setForm] = useState(blank)
  const [editing, setEditing] = useState(null)
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)
  const [loadingTickets, setLoadingTickets] = useState(false)

  async function request(path, options = {}, auth = token) {
    const response = await fetch('/api/' + path, { ...options, headers: { 'Content-Type': 'application/json', ...(auth ? { Authorization: `Bearer ${auth}` } : {}) } })
    if (!response.ok) throw new Error((await response.text()).trim() || `HTTP ${response.status}`)
    return response.status === 204 ? null : response.json()
  }
  async function discover() {
    setPhase('discovering'); setError('')
    try {
      const result = await request('setup/status', {}, '')
      setPhase(result.needsSetup ? 'setup' : 'login')
    } catch (e) { setError(`Could not check setup status: ${e.message}`); setPhase('unavailable') }
  }
  useEffect(() => { discover() }, [])
  async function refresh(auth = token) {
    setLoadingTickets(true)
    try { setTickets(await request('tickets', {}, auth)) }
    finally { setLoadingTickets(false) }
  }
  useEffect(() => { if (token) refresh(token).catch(e => setError(e.message)) }, [token])
  async function authenticate(e) {
    e.preventDefault()
    setError('')
    const isSetup = phase === 'setup'
    const username = credentials.username.trim()
    if (isSetup) {
      const usernameBytes = new TextEncoder().encode(username).length
      const passwordBytes = new TextEncoder().encode(credentials.password).length
      if (!username || usernameBytes > 200) {
        setError('Enter a username of no more than 200 UTF-8 bytes.')
        return
      }
      if (passwordBytes < 12 || passwordBytes > 72) {
        setError('Use a password between 12 and 72 UTF-8 bytes.')
        return
      }
    }
    setBusy(true)
    try {
      const response = await fetch(`/api/${isSetup ? 'setup' : 'login'}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ username: isSetup ? username : credentials.username, password: credentials.password })
      })
      if (!response.ok) {
        if (isSetup && response.status === 409) {
          setPhase('login')
          setCredentials({ username, password: '' })
          setError('Setup is already complete. Sign in instead.')
        } else if (isSetup && response.status === 400) {
          setError('Setup input is invalid. Check the username and password requirements.')
        } else if (isSetup && response.status === 403) {
          setError('Setup is unavailable. Contact your administrator.')
        } else if (!isSetup && response.status === 401) {
          setError('Invalid username or password.')
        } else {
          setError('Could not complete authentication. Please try again later.')
        }
        return
      }
      if (isSetup) {
        setCredentials({ username, password: '' })
        setPhase('login')
      } else {
        const result = await response.json()
        setToken(result.token); setCredentials({ username: '', password: '' })
      }
    } catch {
      setError('Could not connect to the authentication service. Please try again.')
    } finally { setBusy(false) }
  }
  async function save(e) {
    e.preventDefault(); setError(''); setBusy(true)
    try {
      await request(editing ? `tickets/${editing}` : 'tickets', { method: editing ? 'PUT' : 'POST', body: JSON.stringify({ ...form, departure: new Date(form.departure).toISOString() }) })
      setForm(blank); setEditing(null); await refresh()
    } catch (e) { setError(e.message) } finally { setBusy(false) }
  }
  async function cancel(id) {
    if (!window.confirm('Cancel this ticket?')) return
    setError(''); setBusy(true)
    try { await request(`tickets/${id}`, { method: 'DELETE' }); await refresh() }
    catch (e) { setError(e.message) } finally { setBusy(false) }
  }
  function logout() { setToken(''); setTickets([]); setForm(blank); setEditing(null); setError(''); setPhase('login') }

  return <div className="shell">
    <header className="topbar"><div className="brand"><span className="brand-mark" aria-hidden="true">✦</span><span>ATLAS <strong> / OPERATIONS</strong></span></div><div className="topbar-right"><span className="system-label">FLIGHT DESK · LIVE OPERATIONS</span>{token && <button className="text-button" onClick={logout}>Log out ↗</button>}</div></header>
    <main className="workspace">
      <div className="eyebrow"><span className="live-dot" /> OPERATIONS CONSOLE <span className="separator">/</span> TICKET CONTROL</div>
      {token ? <>
        <div className="page-heading"><div><h1>Departure board<span className="period">.</span></h1><p>Manage passenger journeys and monitor ticket status.</p></div><span className="board-count">{String(tickets.length).padStart(2, '0')} <small>TICKETS ON FILE</small></span></div>
        {error && <div className="alert" role="alert">{error}</div>}
        <div className="console-grid"><section className="board panel" aria-labelledby="board-title"><div className="panel-heading"><div><span className="section-index">01 / MANIFEST</span><h2 id="board-title">Ticket manifest</h2></div><button className="refresh-button" type="button" onClick={() => { setError(''); refresh().catch(e => setError(e.message)) }} disabled={loadingTickets || busy}>↻ Refresh</button></div>
          {loadingTickets ? <p className="state" role="status">Loading manifest…</p> : tickets.length === 0 ? <div className="state"><strong>No departures on the board</strong><p>Create a ticket to start the manifest.</p></div> : <div className="table-scroll"><table><thead><tr><th scope="col">FLIGHT / PASSENGER</th><th scope="col">ROUTE</th><th scope="col">DEPARTURE</th><th scope="col">STATUS</th><th scope="col"><span className="sr-only">Actions</span></th></tr></thead><tbody>{tickets.map(t => <tr key={t.id}><td><strong className="flight">{t.flight}</strong><span className="subline">{t.passenger}</span></td><td><span className="route">{t.origin} <span aria-label="to">→</span> {t.destination}</span></td><td className="date">{new Date(t.departure).toLocaleString()}</td><td><span className={`status status-${t.status === 'booked' ? 'booked' : 'cancelled'}`}>{t.status}</span></td><td>{t.status === 'booked' && <div className="row-actions"><button disabled={busy} onClick={() => { setEditing(t.id); setForm({ ...t, departure: localDateTime(t.departure) }); setError('') }}>Edit</button><button className="danger" disabled={busy} onClick={() => cancel(t.id)}>Cancel</button></div>}</td></tr>)}</tbody></table></div>}
        </section><section className="editor panel" aria-labelledby="editor-title"><div className="panel-heading"><div><span className="section-index">02 / TICKET DESK</span><h2 id="editor-title">{editing ? 'Edit ticket' : 'New ticket'}</h2></div><span className="editor-symbol" aria-hidden="true">↗</span></div><p className="form-intro">{editing ? 'Update the journey details below.' : 'Add a passenger to the departure board.'}</p><form onSubmit={save}><div className="fields">{fields.map(field => <label key={field}>{field}<input required type={field === 'departure' ? 'datetime-local' : 'text'} maxLength={{ passenger: 200, flight: 30, origin: 100, destination: 100 }[field]} value={form[field]} onChange={e => setForm({ ...form, [field]: e.target.value })} /></label>)}</div><div className="form-actions"><button className="primary" disabled={busy}>{busy ? 'Working…' : editing ? 'Save changes →' : 'Create ticket →'}</button>{editing && <button type="button" className="text-button" onClick={() => { setEditing(null); setForm(blank) }}>Discard</button>}</div></form></section></div>
      </> : <div className="access-layout"><section className="access-copy"><span className="section-index">SECURE ACCESS / 001</span><h1>{phase === 'setup' ? 'Prepare for departure.' : 'The flight desk starts here.'}</h1><p>{phase === 'setup' ? 'Create the first administrator account to open the operations console.' : 'A single place to manage tickets, routes and departures.'}</p><div className="access-rule"><span>ATLAS AIR · OPERATIONS SYSTEM</span><span>✦</span></div></section><section className="access-card panel" aria-labelledby="access-title"><span className="section-index">{phase === 'setup' ? 'FIRST-TIME CONFIGURATION' : 'AUTHORIZED PERSONNEL ONLY'}</span><h2 id="access-title">{phase === 'setup' ? 'Create administrator' : phase === 'discovering' ? 'Checking access' : phase === 'unavailable' ? 'Connection unavailable' : 'Welcome back'}</h2><p>{phase === 'setup' ? 'Setup is available only while the server explicitly permits it.' : phase === 'login' ? 'Sign in to access the ticket manifest.' : phase === 'discovering' ? 'Checking whether this desk needs initial setup…' : 'Could not reach the setup service.'}</p>{error && <div className="alert" role="alert">{error}</div>}{phase === 'unavailable' && <button className="primary" onClick={discover}>Retry connection →</button>}{(phase === 'login' || phase === 'setup') && <form onSubmit={authenticate}><label>Username<input autoComplete="username" value={credentials.username} onChange={e => setCredentials({ ...credentials, username: e.target.value })} required /></label><label>Password<input type="password" autoComplete={phase === 'setup' ? 'new-password' : 'current-password'} aria-describedby={phase === 'setup' ? 'setup-password-help' : undefined} value={credentials.password} onChange={e => setCredentials({ ...credentials, password: e.target.value })} required />{phase === 'setup' && <span id="setup-password-help">Use 12–72 UTF-8 bytes (12–72 characters for ASCII; other characters may use more bytes).</span>}</label><button className="primary" disabled={busy}>{busy ? 'Working…' : phase === 'setup' ? 'Create administrator →' : 'Log in →'}</button></form>}</section></div>}
    </main><footer className="footer"><span>ATLAS / FLIGHT OPERATIONS</span><span>AUTHORIZED ACCESS ONLY</span></footer>
  </div>
}

createRoot(document.getElementById('root')).render(<App />)
