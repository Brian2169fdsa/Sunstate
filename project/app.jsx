/* Sun State Data Chat — main React app
 * Real text-to-SQL agent via /api/chat (Claude tool-use loop + pg).
 */

const { useState, useEffect, useRef, useCallback } = React;

/* ───────────────────────── Icons (inline) ───────────────────────── */
const Icon = {
  Send: (p) => (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor"
      strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" {...p}>
      <path d="M22 2L11 13" /><path d="M22 2l-7 20-4-9-9-4 20-7z" />
    </svg>
  ),
  Sun: (p) => (
    <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="white"
      strokeWidth="1.9" strokeLinecap="round" strokeLinejoin="round" {...p}>
      <circle cx="12" cy="12" r="4" />
      <path d="M12 2v2M12 20v2M4.93 4.93l1.41 1.41M17.66 17.66l1.41 1.41M2 12h2M20 12h2M4.93 19.07l1.41-1.41M17.66 6.34l1.41-1.41" />
    </svg>
  ),
  Sparkle: (p) => (
    <svg width="14" height="14" viewBox="0 0 24 24" fill="currentColor" {...p}>
      <path d="M12 2l1.8 5.2L19 9l-5.2 1.8L12 16l-1.8-5.2L5 9l5.2-1.8L12 2z" />
    </svg>
  ),
  TrendDown: (p) => (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor"
      strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" {...p}>
      <polyline points="22 17 13.5 8.5 8.5 13.5 2 7" />
      <polyline points="16 17 22 17 22 11" />
    </svg>
  ),
  BarChart: (p) => (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor"
      strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" {...p}>
      <line x1="12" y1="20" x2="12" y2="10" /><line x1="18" y1="20" x2="18" y2="4" />
      <line x1="6" y1="20" x2="6" y2="16" />
    </svg>
  ),
  Slash: (p) => (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor"
      strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" {...p}>
      <circle cx="12" cy="12" r="10" /><line x1="4.93" y1="4.93" x2="19.07" y2="19.07" />
    </svg>
  ),
  Dollar: (p) => (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor"
      strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" {...p}>
      <line x1="12" y1="1" x2="12" y2="23" />
      <path d="M17 5H9.5a3.5 3.5 0 0 0 0 7h5a3.5 3.5 0 0 1 0 7H6" />
    </svg>
  ),
  Layers: (p) => (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor"
      strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" {...p}>
      <polygon points="12 2 2 7 12 12 22 7 12 2" />
      <polyline points="2 17 12 22 22 17" /><polyline points="2 12 12 17 22 12" />
    </svg>
  ),
};

/* ───────────────────────── Suggested chips ───────────────────────── */
const SUGGESTIONS = [
  { label: "Which facilities are down this month?", icon: "TrendDown" },
  { label: "Top facilities by trip volume",         icon: "BarChart"  },
  { label: "Cancellation rate by facility",          icon: "Slash"     },
  { label: "Revenue trend for Memorial Regional",    icon: "Dollar"    },
  { label: "Stretcher vs wheelchair mix",            icon: "Layers"    },
];

/* ───────────────────────── SQL block ────────────────────────────── */
function SqlBlock({ sql }) {
  const [open, setOpen] = React.useState(false);
  return (
    <div className="sqlblock">
      <button className="sqlblock__toggle" onClick={() => setOpen(o => !o)}>
        <span className="toolchip__dot" />
        <span>run_readonly_query</span>
        <span className="sqlblock__arrow">{open ? '▴' : '▾'}</span>
      </button>
      {open && <pre className="sqlblock__code">{sql}</pre>}
    </div>
  );
}

/* ───────────────────────── SQL table ────────────────────────────── */
function SqlTable({ rows }) {
  if (!rows || rows.length === 0) return null;

  const columns = Object.keys(rows[0]);
  const displayRows = rows.slice(0, 100);
  const truncated = rows.length > 100;

  function formatCell(val) {
    if (val === null || val === undefined) return '—';
    if (typeof val === 'boolean') return val ? 'Yes' : 'No';
    if (typeof val === 'object') return JSON.stringify(val);
    return String(val);
  }

  return (
    <div className="result fadeup" style={{ overflowX: 'auto' }}>
      <div className="result__head">
        <div className="result__title">Query results</div>
        <div className="result__sub">{rows.length.toLocaleString()} row{rows.length !== 1 ? 's' : ''}</div>
      </div>
      <table className="tbl">
        <thead>
          <tr>
            {columns.map(col => (
              <th key={col} className={typeof rows[0][col] === 'number' ? 'num' : ''}>
                {col}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {displayRows.map((row, i) => (
            <tr key={i}>
              {columns.map(col => (
                <td key={col} className={typeof row[col] === 'number' ? 'num' : ''}>
                  {formatCell(row[col])}
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
      {truncated && (
        <div className="result__more">
          Showing 100 of {rows.length.toLocaleString()} rows
        </div>
      )}
    </div>
  );
}

/* ───────────────────────── Messages ───────────────────────── */
function UserMessage({ text }) {
  return (
    <div className="msg msg--user fadeup">
      <div className="msg__bubble">{text}</div>
    </div>
  );
}

function AssistantMessage({ msg }) {
  return (
    <div className="msg msg--assistant fadeup">
      <div className="msg__avatar msg__avatar--assistant"><Icon.Sparkle /></div>
      <div className="msg__bubble">
        {msg.sql && <SqlBlock sql={msg.sql} />}
        {msg.text && <div className="msg__text">{msg.text}</div>}
        {msg.rows && msg.rows.length > 0 && <SqlTable rows={msg.rows} />}
        {msg.error && <div className="alert">{msg.error}</div>}
      </div>
    </div>
  );
}

function TypingMessage({ status }) {
  return (
    <div className="msg msg--assistant fadeup">
      <div className="msg__avatar msg__avatar--assistant"><Icon.Sparkle /></div>
      <div className="msg__bubble">
        <div className="typing">
          <span className="typing__dot" />
          <span className="typing__dot" />
          <span className="typing__dot" />
          <span className="typing__label">{status}</span>
        </div>
      </div>
    </div>
  );
}

/* ───────────────────────── Welcome ───────────────────────── */
function Welcome({ onPick }) {
  return (
    <div className="welcome fadeup">
      <div className="welcome__eyebrow">Sun State Data</div>
      <h1 className="welcome__title">Ask anything about your trips.</h1>
      <p className="welcome__sub">
        Query the trips table in plain English — volume, cancellations, revenue,
        service mix, trends. Read-only. No patient data leaves Sun State.
      </p>
      <div className="welcome__grid">
        {SUGGESTIONS.map(s => {
          const IconComp = Icon[s.icon] || Icon.Sparkle;
          return (
            <button key={s.label} className="welcome__card" onClick={() => onPick(s.label)}>
              <div className="welcome__card__icon"><IconComp /></div>
              <div>
                <div className="welcome__card__title">{s.label}</div>
                <div className="welcome__card__sub">Tap to run</div>
              </div>
            </button>
          );
        })}
      </div>
    </div>
  );
}

/* ───────────────────────── App ───────────────────────── */
const STATUS_CYCLE = [
  'Analyzing your question…',
  'Writing SQL…',
  'Running query…',
  'Composing answer…',
];

function App() {
  const [messages, setMessages] = useState([]);
  const [input, setInput] = useState('');
  const [busy, setBusy] = useState(false);
  const [status, setStatus] = useState('');
  const scrollRef = useRef(null);
  const taRef = useRef(null);

  // Autoscroll on new content
  useEffect(() => {
    const el = scrollRef.current;
    if (!el) return;
    el.scrollTop = el.scrollHeight;
  }, [messages, busy, status]);

  // Auto-grow textarea
  useEffect(() => {
    const ta = taRef.current;
    if (!ta) return;
    ta.style.height = 'auto';
    ta.style.height = Math.min(180, ta.scrollHeight) + 'px';
  }, [input]);

  const ask = useCallback(async (question) => {
    const q = question.trim();
    if (!q || busy) return;
    setInput('');

    const userId = 'u' + Date.now();
    const newUserMsg = { id: userId, role: 'user', text: q };

    // Build API history from current messages + this question
    const apiHistory = [
      ...messages.filter(m => m.text),
      newUserMsg,
    ].map(m => ({
      role: m.role === 'user' ? 'user' : 'assistant',
      content: m.text,
    }));

    setMessages(prev => [...prev, newUserMsg]);
    setBusy(true);

    let cycleIdx = 0;
    setStatus(STATUS_CYCLE[0]);
    const timer = setInterval(() => {
      cycleIdx = (cycleIdx + 1) % STATUS_CYCLE.length;
      setStatus(STATUS_CYCLE[cycleIdx]);
    }, 2800);

    try {
      const token = window._sunstateSession?.access_token;
      const resp = await fetch('/api/chat', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          ...(token ? { Authorization: `Bearer ${token}` } : {}),
        },
        body: JSON.stringify({ messages: apiHistory }),
      });

      if (!resp.ok) {
        const err = await resp.json().catch(() => ({}));
        throw new Error(err.error || `Error ${resp.status}`);
      }

      const data = await resp.json();
      setMessages(prev => [...prev, {
        id: 'a' + Date.now(),
        role: 'assistant',
        text: data.text,
        sql: data.sql || null,
        rows: data.rows || null,
      }]);
    } catch (e) {
      setMessages(prev => [...prev, {
        id: 'a' + Date.now(),
        role: 'assistant',
        error: 'Something went wrong: ' + (e.message || String(e)),
      }]);
    } finally {
      clearInterval(timer);
      setBusy(false);
      setStatus('');
    }
  }, [busy, messages]);

  const onKeyDown = (e) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      ask(input);
    }
  };

  const hasMessages = messages.length > 0;

  return (
    <div className="app">
      <header className="appHeader">
        <div className="appHeader__inner">
          <a className="brand" href="#">
            <div className="brand__mark"><Icon.Sun /></div>
            <div>
              <div className="brand__name">Sun State Transportation</div>
              <div className="brand__sub">Data Chat · Read-only</div>
            </div>
          </a>
          <div className="appHeader__spacer" />
          <div className="appHeader__meta">
            <span><span className="dot" /> Live</span>
            <span>{window.SunStateMock?.tripsCount?.toLocaleString() || '—'} trips indexed</span>
          </div>
          <div className="appHeader__user">
            <div className="appHeader__avatar">{window._sunstateUser?.initials || '?'}</div>
            <span style={{ fontSize: 12, fontWeight: 600, color: 'var(--text)' }}>{window._sunstateUser?.displayName || ''}</span>
          </div>
        </div>
      </header>

      <div className="chat">
        <div className="chat__scroll" ref={scrollRef}>
          <div className="chat__inner">
            {!hasMessages && <Welcome onPick={(q) => ask(q)} />}
            {messages.map(m =>
              m.role === 'user'
                ? <UserMessage key={m.id} text={m.text} />
                : <AssistantMessage key={m.id} msg={m} />
            )}
            {busy && <TypingMessage status={status} />}
          </div>
        </div>

        <div className="composer">
          <div className="composer__inner">
            {hasMessages && (
              <div className="chips">
                {SUGGESTIONS.map(s => (
                  <button key={s.label}
                          className="chip"
                          disabled={busy}
                          onClick={() => ask(s.label)}>
                    {s.label}
                  </button>
                ))}
              </div>
            )}
            <div className="composer__box">
              <textarea
                ref={taRef}
                className="composer__textarea"
                rows={1}
                placeholder="Ask about trips, facilities, revenue, cancellations…"
                value={input}
                onChange={e => setInput(e.target.value)}
                onKeyDown={onKeyDown}
                disabled={busy}
              />
              <button className="composer__send"
                      disabled={busy || !input.trim()}
                      onClick={() => ask(input)}
                      aria-label="Send">
                <Icon.Send />
              </button>
            </div>
            <div className="composer__footer">
              <span>Press <kbd>Enter</kbd> to send · <kbd>Shift</kbd>+<kbd>Enter</kbd> for newline</span>
              <span>Queries are parameterized · No patient data in scope</span>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

ReactDOM.createRoot(document.getElementById('root')).render(<App />);
