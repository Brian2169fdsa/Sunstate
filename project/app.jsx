/* Sun State Data Chat — text-to-SQL agent UI
 * Charts: recharts (window.Recharts via CDN)
 * Markdown: marked (window.marked via CDN)
 */

const { useState, useEffect, useRef, useCallback } = React;

/* ── Theme constants ───────────────────────────────────────── */
const NAVY   = '#1a2744';
const BLUE   = '#2e7bce';
const GREEN  = '#28a745';
const RED    = '#dc3545';
const CHART_COLORS = [BLUE, NAVY, GREEN, '#fd7e14', '#6f42c1', '#20c997', RED, '#e83e8c'];

/* ── Icons ─────────────────────────────────────────────────── */
const Icon = {
  Send: (p) => (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor"
      strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" {...p}>
      <path d="M22 2L11 13" /><path d="M22 2l-7 20-4-9-9-4 20-7z" />
    </svg>
  ),
  Sun: (p) => (
    <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor"
      strokeWidth="1.9" strokeLinecap="round" strokeLinejoin="round" {...p}>
      <circle cx="12" cy="12" r="4" />
      <path d="M12 2v2M12 20v2M4.93 4.93l1.41 1.41M17.66 17.66l1.41 1.41M2 12h2M20 12h2M4.93 19.07l1.41-1.41M17.66 6.34l1.41-1.41" />
    </svg>
  ),
  Sparkle: (p) => (
    <svg width="13" height="13" viewBox="0 0 24 24" fill="currentColor" {...p}>
      <path d="M12 2l1.8 5.2L19 9l-5.2 1.8L12 16l-1.8-5.2L5 9l5.2-1.8L12 2z" />
    </svg>
  ),
  TrendDown: (p) => (
    <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor"
      strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" {...p}>
      <polyline points="22 17 13.5 8.5 8.5 13.5 2 7" />
      <polyline points="16 17 22 17 22 11" />
    </svg>
  ),
  BarChart: (p) => (
    <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor"
      strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" {...p}>
      <line x1="12" y1="20" x2="12" y2="10" /><line x1="18" y1="20" x2="18" y2="4" />
      <line x1="6" y1="20" x2="6" y2="16" />
    </svg>
  ),
  Slash: (p) => (
    <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor"
      strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" {...p}>
      <circle cx="12" cy="12" r="10" /><line x1="4.93" y1="4.93" x2="19.07" y2="19.07" />
    </svg>
  ),
  Dollar: (p) => (
    <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor"
      strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" {...p}>
      <line x1="12" y1="1" x2="12" y2="23" />
      <path d="M17 5H9.5a3.5 3.5 0 0 0 0 7h5a3.5 3.5 0 0 1 0 7H6" />
    </svg>
  ),
  Layers: (p) => (
    <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor"
      strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" {...p}>
      <polygon points="12 2 2 7 12 12 22 7 12 2" />
      <polyline points="2 17 12 22 22 17" /><polyline points="2 12 12 17 22 12" />
    </svg>
  ),
};

/* ── Suggestion chips ──────────────────────────────────────── */
const SUGGESTIONS = [
  { label: "Which facilities are down this month?",      icon: "TrendDown" },
  { label: "Top facilities by trip volume",              icon: "BarChart"  },
  { label: "Cancellation rate by facility",              icon: "Slash"     },
  { label: "Revenue trend for Memorial Regional",        icon: "Dollar"    },
  { label: "Stretcher vs wheelchair mix",                icon: "Layers"    },
];

/* ── Markdown rendering ─────────────────────────────────────── */
function renderMarkdown(text) {
  if (!text) return '';
  const m = window.marked;
  if (!m) return text;
  try {
    return m.parse(text, { breaks: true, gfm: true });
  } catch (_) {
    return text;
  }
}

/* ── Delta helpers ──────────────────────────────────────────── */
function isDeltaCol(name) {
  return /change|delta|diff|trend|growth|decline|variance/i.test(name);
}
function deltaClass(val) {
  const n = typeof val === 'number' ? val : parseFloat(String(val));
  if (!isNaN(n)) return n > 0 ? 'delta--pos' : n < 0 ? 'delta--neg' : '';
  if (typeof val === 'string') {
    if (val.startsWith('+')) return 'delta--pos';
    if (val.startsWith('-')) return 'delta--neg';
  }
  return '';
}

/* ── Stat tiles ─────────────────────────────────────────────── */
function StatTiles({ stats }) {
  if (!stats || !stats.length) return null;
  return (
    <div className="stat-tiles">
      {stats.map((s, i) => {
        const cls = s.delta
          ? (s.delta.startsWith('+') ? 'stat-tile__delta--pos' : s.delta.startsWith('-') ? 'stat-tile__delta--neg' : '')
          : '';
        return (
          <div key={i} className="stat-tile">
            <div className="stat-tile__label">{s.label}</div>
            <div className="stat-tile__value">{s.value}</div>
            {s.delta && <div className={`stat-tile__delta ${cls}`}>{s.delta}</div>}
          </div>
        );
      })}
    </div>
  );
}

/* ── Chart block ────────────────────────────────────────────── */
function ChartBlock({ chart }) {
  if (!chart || !window.Recharts) return null;
  const { type, title, xKey, series = [], data = [] } = chart;
  if (!data.length || !series.length || !xKey) return null;

  try {
    const RC = window.Recharts;
    const tickStyle = { fontSize: 11, fill: '#6c757d' };

    if (type === 'line' || type === 'area') {
      const Wrapper = type === 'area' ? RC.AreaChart : RC.LineChart;
      const Series  = type === 'area' ? RC.Area      : RC.Line;
      return (
        <div className="chart-card">
          {title && <div className="chart-card__title">{title}</div>}
          <RC.ResponsiveContainer width="100%" height={220}>
            <Wrapper data={data} margin={{ top: 8, right: 20, left: 0, bottom: 4 }}>
              <RC.CartesianGrid strokeDasharray="3 3" stroke="#eaecef" />
              <RC.XAxis dataKey={xKey} tick={tickStyle} />
              <RC.YAxis tick={tickStyle} width={48} />
              <RC.Tooltip contentStyle={{ fontSize: 12, borderRadius: 8, border: '1px solid #e2e6ec' }} />
              <RC.Legend wrapperStyle={{ fontSize: 12, paddingTop: 8 }} />
              {series.map((s, i) => (
                <Series key={s.dataKey} type="monotone" dataKey={s.dataKey} name={s.name}
                  stroke={s.color || CHART_COLORS[i % CHART_COLORS.length]}
                  fill={s.color || CHART_COLORS[i % CHART_COLORS.length]}
                  fillOpacity={type === 'area' ? 0.12 : 1}
                  strokeWidth={2} dot={false} activeDot={{ r: 4 }} />
              ))}
            </Wrapper>
          </RC.ResponsiveContainer>
        </div>
      );
    }

    if (type === 'bar') {
      const barH = Math.max(200, data.length * 34 + 70);
      return (
        <div className="chart-card">
          {title && <div className="chart-card__title">{title}</div>}
          <RC.ResponsiveContainer width="100%" height={barH}>
            <RC.BarChart data={data} layout="vertical" margin={{ top: 4, right: 20, left: 8, bottom: 4 }}>
              <RC.CartesianGrid strokeDasharray="3 3" stroke="#eaecef" horizontal={false} />
              <RC.XAxis type="number" tick={tickStyle} />
              <RC.YAxis type="category" dataKey={xKey} tick={tickStyle} width={160} />
              <RC.Tooltip contentStyle={{ fontSize: 12, borderRadius: 8, border: '1px solid #e2e6ec' }} />
              <RC.Legend wrapperStyle={{ fontSize: 12, paddingTop: 8 }} />
              {series.map((s, i) => (
                <RC.Bar key={s.dataKey} dataKey={s.dataKey} name={s.name}
                  fill={s.color || CHART_COLORS[i % CHART_COLORS.length]}
                  radius={[0, 4, 4, 0]} maxBarSize={22}>
                  {data.map((row, ri) => {
                    const v = row[s.dataKey];
                    const fill = typeof v === 'number' && v < 0 ? RED
                      : (s.color || CHART_COLORS[i % CHART_COLORS.length]);
                    return <RC.Cell key={ri} fill={fill} />;
                  })}
                </RC.Bar>
              ))}
            </RC.BarChart>
          </RC.ResponsiveContainer>
        </div>
      );
    }

    if (type === 'donut') {
      return (
        <div className="chart-card">
          {title && <div className="chart-card__title">{title}</div>}
          <RC.ResponsiveContainer width="100%" height={220}>
            <RC.PieChart>
              <RC.Pie data={data} dataKey={series[0]?.dataKey || 'value'} nameKey={xKey}
                cx="50%" cy="50%" innerRadius={55} outerRadius={88} paddingAngle={2}>
                {data.map((_, i) => (
                  <RC.Cell key={i} fill={CHART_COLORS[i % CHART_COLORS.length]} />
                ))}
              </RC.Pie>
              <RC.Tooltip contentStyle={{ fontSize: 12, borderRadius: 8 }} />
              <RC.Legend wrapperStyle={{ fontSize: 12, paddingTop: 8 }} />
            </RC.PieChart>
          </RC.ResponsiveContainer>
        </div>
      );
    }
  } catch (_) {
    return null; // degrade gracefully — table still shows
  }
  return null;
}

/* ── SQL collapsible ────────────────────────────────────────── */
function SqlBlock({ sql }) {
  const [open, setOpen] = useState(false);
  return (
    <div className="sqlblock">
      <button className="sqlblock__toggle" onClick={() => setOpen(o => !o)}>
        <span className="sqlblock__dot" />
        <span>run_readonly_query</span>
        <span className="sqlblock__arrow">{open ? '▴' : '▾'}</span>
      </button>
      {open && <pre className="sqlblock__code">{sql}</pre>}
    </div>
  );
}

/* ── Generic SQL results table ──────────────────────────────── */
function SqlTable({ rows }) {
  if (!rows || rows.length === 0) return null;
  const cols = Object.keys(rows[0]);
  const display = rows.slice(0, 100);
  const truncated = rows.length > 100;

  function fmtCell(val) {
    if (val === null || val === undefined) return '—';
    if (typeof val === 'boolean') return val ? 'Yes' : 'No';
    if (typeof val === 'object') return JSON.stringify(val);
    return String(val);
  }

  return (
    <div className="sql-table-wrap">
      <div className="sql-table-head">
        <span className="sql-table-head__title">Query results</span>
        <span className="sql-table-head__count">{rows.length.toLocaleString()} row{rows.length !== 1 ? 's' : ''}</span>
      </div>
      <div style={{ overflowX: 'auto' }}>
        <table className="dtbl">
          <thead>
            <tr>
              {cols.map(c => (
                <th key={c} className={typeof rows[0][c] === 'number' ? 'num' : ''}>
                  {c.replace(/_/g, ' ')}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {display.map((row, ri) => (
              <tr key={ri}>
                {cols.map(c => {
                  const isNum = typeof row[c] === 'number';
                  const isDelta = isDeltaCol(c);
                  const extra = isDelta ? ' ' + deltaClass(row[c]) : '';
                  return (
                    <td key={c} className={(isNum ? 'num' : '') + extra}>
                      {fmtCell(row[c])}
                    </td>
                  );
                })}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {truncated && (
        <div className="sql-table-more">Showing 100 of {rows.length.toLocaleString()} rows</div>
      )}
    </div>
  );
}

/* ── Messages ───────────────────────────────────────────────── */
function UserMessage({ text }) {
  return (
    <div className="msg msg--user fadeup">
      <div className="msg__bubble msg__bubble--user">{text}</div>
    </div>
  );
}

function AssistantMessage({ msg }) {
  const html = renderMarkdown(msg.text || '');
  return (
    <div className="msg msg--assistant fadeup">
      <div className="msg__avatar"><Icon.Sparkle /></div>
      <div className="msg__card">
        {msg.sql && <SqlBlock sql={msg.sql} />}
        {msg.stats && <StatTiles stats={msg.stats} />}
        {msg.chart && <ChartBlock chart={msg.chart} />}
        {html && (
          <div className="msg__markdown"
               dangerouslySetInnerHTML={{ __html: html }} />
        )}
        {msg.rows && msg.rows.length > 0 && <SqlTable rows={msg.rows} />}
        {msg.error && <div className="msg__error">{msg.error}</div>}
      </div>
    </div>
  );
}

function TypingMessage({ status }) {
  return (
    <div className="msg msg--assistant fadeup">
      <div className="msg__avatar"><Icon.Sparkle /></div>
      <div className="msg__card msg__card--typing">
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

/* ── Welcome / empty state ──────────────────────────────────── */
function Welcome({ onPick }) {
  return (
    <div className="welcome fadeup">
      <div className="welcome__eyebrow">Sun State Analytics</div>
      <h1 className="welcome__title">Ask anything about your trips.</h1>
      <p className="welcome__sub">
        Plain-English queries against the warehouse — volume, revenue, cancellations,
        service mix, trends. Read-only. No patient data.
      </p>
      <div className="welcome__grid">
        {SUGGESTIONS.map(s => {
          const IC = Icon[s.icon] || Icon.Sparkle;
          return (
            <button key={s.label} className="welcome__card" onClick={() => onPick(s.label)}>
              <div className="welcome__card__icon"><IC /></div>
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

/* ── App ────────────────────────────────────────────────────── */
const STATUS_CYCLE = [
  'Analyzing your question…',
  'Writing SQL…',
  'Running query…',
  'Composing answer…',
];

function App() {
  const [messages, setMessages] = useState([]);
  const [input, setInput]       = useState('');
  const [busy, setBusy]         = useState(false);
  const [status, setStatus]     = useState('');
  const [tripCount, setTripCount] = useState(null);
  const scrollRef = useRef(null);
  const taRef     = useRef(null);

  useEffect(() => {
    const el = scrollRef.current;
    if (el) el.scrollTop = el.scrollHeight;
  }, [messages, busy]);

  useEffect(() => {
    let cancelled = false;
    const id = setInterval(() => {
      const token = window._sunstateSession?.access_token;
      if (!token) return;
      clearInterval(id);
      fetch('/api/count', { headers: { Authorization: `Bearer ${token}` } })
        .then(r => r.ok ? r.json() : null)
        .then(d => { if (!cancelled && d?.count != null) setTripCount(d.count); })
        .catch(() => {});
    }, 300);
    return () => { cancelled = true; clearInterval(id); };
  }, []);

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

    const newUserMsg = { id: 'u' + Date.now(), role: 'user', text: q };

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
        text:  data.text  || null,
        sql:   data.sql   || null,
        rows:  data.rows  || null,
        chart: data.chart || null,
        stats: data.stats || null,
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
    if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); ask(input); }
  };

  const hasMessages = messages.length > 0;

  return (
    <div className="app">
      {/* ── Header ── */}
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
            {tripCount !== null && <span>{tripCount.toLocaleString()} trips indexed</span>}
          </div>
          <div className="appHeader__user">
            <div className="appHeader__avatar">
              {window._sunstateUser?.initials || '?'}
            </div>
            <span className="appHeader__username">
              {window._sunstateUser?.displayName || ''}
            </span>
          </div>
        </div>
      </header>

      {/* ── Chat ── */}
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

        {/* ── Composer ── */}
        <div className="composer">
          <div className="composer__inner">
            {hasMessages && (
              <div className="chips">
                {SUGGESTIONS.map(s => (
                  <button key={s.label} className="chip" disabled={busy} onClick={() => ask(s.label)}>
                    {s.label}
                  </button>
                ))}
              </div>
            )}
            <div className="composer__box">
              <textarea ref={taRef} className="composer__textarea" rows={1}
                placeholder="Ask about trips, facilities, revenue, cancellations…"
                value={input} onChange={e => setInput(e.target.value)}
                onKeyDown={onKeyDown} disabled={busy} />
              <button className="composer__send" disabled={busy || !input.trim()}
                onClick={() => ask(input)} aria-label="Send">
                <Icon.Send />
              </button>
            </div>
            <div className="composer__footer">
              <span>Press <kbd>Enter</kbd> to send · <kbd>Shift+Enter</kbd> for newline</span>
              <span>Queries are read-only · No patient data in scope</span>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

ReactDOM.createRoot(document.getElementById('root')).render(<App />);
