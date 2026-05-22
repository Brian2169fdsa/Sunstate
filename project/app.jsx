/* Sun State Data Chat — main React app
 * window.claude.complete drives a 2-step tool-use loop:
 *   1) planner picks a tool + args (JSON)
 *   2) summarizer narrates the rows the mock backend returns
 */

const { useState, useEffect, useRef, useCallback, useMemo } = React;

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

/* ───────────────────────── Claude pipeline ───────────────────────── */
const PLANNER_PROMPT = `You are the routing layer for Sun State Transportation's data chat. The user has a question about trips. Decide which read-only tool to call.

Available tools (read-only SQL against the trips table):
- volume_by_facility(period)             — Trip counts per facility. period ∈ "this_month" | "last_month" | "last_30_days" | "last_90_days" | "ytd". Default: "this_month".
- trend(facility, weeks)                  — Weekly completed/canceled trend for ONE facility. weeks default 8.
- cancellations(period, by_facility)      — Cancellation counts and rates. by_facility=true returns per-facility breakdown.
- revenue(period, facility?)              — Revenue total (only status='completed' trips count). facility optional.
- service_mix(facility?, period?)          — Stretcher / Wheelchair / Ambulatory mix, % share. period default "last_30_days".
- facilities_down(period)                 — Facilities with the biggest decline vs the prior equal-length period.

Rules:
- Only status='completed' counts as a completed trip; status='canceled' is a cancellation.
- No patient data exists in the table — never claim there is any.
- Pick ONE tool. If the question doesn't fit any tool, return tool:null with a short clarification.
- Resolve facility names loosely (e.g. "Memorial" → "Memorial Regional Hospital"); pass the user's wording — backend does fuzzy match.

Respond with ONLY a JSON object, no prose, no markdown fences:
{"tool": "<name|null>", "args": { ... }, "rationale": "<one short sentence>"}

User question: `;

const SUMMARIZER_PROMPT = `You are the data analyst voice of Sun State Transportation. The user asked a question; you ran a query and got rows. Write a brief plain-English answer.

Style:
- 2–4 sentences max.
- Lead with the headline number or insight.
- Call out the top 1–3 facilities by name when relevant.
- Do NOT output a markdown table — the UI renders the rows automatically.
- Do NOT mention "tool", "query", "JSON", or "rows".
- Use direct, operator-grade tone. No filler ("Great question…", "I hope this helps").
- If the data is empty or shows an error, say so plainly.

Context:
- Only status='completed' is a completed trip.
- Money in revenue rows is USD whole-dollars.

`;

function safeJSON(s) {
  if (!s) return null;
  // Strip code fences if any
  const cleaned = s.replace(/^```(?:json)?\s*/i, "").replace(/```\s*$/, "").trim();
  // Try to find first { ... } block
  const match = cleaned.match(/\{[\s\S]*\}/);
  if (!match) return null;
  try { return JSON.parse(match[0]); } catch { return null; }
}

async function planTool(userQuestion) {
  const text = await window.claude.complete(PLANNER_PROMPT + userQuestion);
  const parsed = safeJSON(text);
  if (!parsed) return { tool: null, message: "I couldn't parse a tool decision. Try rephrasing." };
  return parsed;
}

async function summarize(userQuestion, plan, result) {
  const prompt = SUMMARIZER_PROMPT +
    `Question: ${userQuestion}\n` +
    `Tool used: ${plan.tool} (${JSON.stringify(plan.args || {})})\n` +
    `Result:\n${JSON.stringify(result, null, 2)}\n\n` +
    `Write the answer now.`;
  const text = await window.claude.complete(prompt);
  return text.trim();
}

/* ───────────────────────── Renderers ───────────────────────── */

function bar(value, max, variant = "") {
  const pct = max ? Math.max(2, Math.round((value / max) * 100)) : 0;
  return (
    <span className="bar">
      <span className={"bar__fill " + variant} style={{ width: pct + "%" }} />
    </span>
  );
}

function formatMoney(n) {
  return "$" + Number(n).toLocaleString("en-US");
}

function ResultCard({ title, subtitle, children }) {
  return (
    <div className="result fadeup">
      <div className="result__head">
        <div className="result__title">{title}</div>
        {subtitle && <div className="result__sub">{subtitle}</div>}
      </div>
      {children}
    </div>
  );
}

function VolumeTable({ data }) {
  const rows = data.rows.slice(0, 8);
  const max = Math.max(...rows.map(r => r.completed), 1);
  return (
    <ResultCard
      title="Trip volume by facility"
      subtitle={`${data.period} • completed / total`}
    >
      <table className="tbl">
        <thead>
          <tr>
            <th>Facility</th>
            <th className="num">Completed</th>
            <th>Share</th>
            <th className="num">Total</th>
          </tr>
        </thead>
        <tbody>
          {rows.map(r => (
            <tr key={r.facility}>
              <td className="facility">{r.facility}</td>
              <td className="num">{r.completed.toLocaleString()}</td>
              <td>{bar(r.completed, max)}</td>
              <td className="num">{r.total.toLocaleString()}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </ResultCard>
  );
}

function TrendTable({ data }) {
  const max = Math.max(...data.rows.map(r => r.completed + r.canceled), 1);
  return (
    <ResultCard
      title={`Weekly trend — ${data.facility}`}
      subtitle={`${data.rows.length} weeks • completed vs canceled`}
    >
      <table className="tbl">
        <thead>
          <tr>
            <th>Week ending</th>
            <th className="num">Completed</th>
            <th className="num">Canceled</th>
            <th>Volume</th>
          </tr>
        </thead>
        <tbody>
          {data.rows.map(r => (
            <tr key={r.week_ending}>
              <td>{r.week_ending}</td>
              <td className="num">{r.completed}</td>
              <td className="num">{r.canceled}</td>
              <td>{bar(r.completed, max)}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </ResultCard>
  );
}

function CancellationsTable({ data }) {
  if (data.rows.length === 1 && data.rows[0].scope) {
    const r = data.rows[0];
    return (
      <ResultCard title="Cancellation rate" subtitle={data.period}>
        <div className="stats">
          <div className="stat">
            <div className="stat__label">Rate</div>
            <div className="stat__value">{r.rate_pct}%</div>
          </div>
          <div className="stat">
            <div className="stat__label">Canceled</div>
            <div className="stat__value">{r.canceled.toLocaleString()}</div>
          </div>
          <div className="stat">
            <div className="stat__label">Total trips</div>
            <div className="stat__value">{r.total.toLocaleString()}</div>
          </div>
        </div>
      </ResultCard>
    );
  }
  const max = Math.max(...data.rows.map(r => r.rate_pct), 1);
  return (
    <ResultCard title="Cancellation rate by facility" subtitle={data.period}>
      <table className="tbl">
        <thead>
          <tr>
            <th>Facility</th>
            <th className="num">Canceled</th>
            <th className="num">Total</th>
            <th>Rate</th>
            <th className="num">%</th>
          </tr>
        </thead>
        <tbody>
          {data.rows.map(r => {
            const variant = r.rate_pct >= 15 ? "bar__fill--neg" : r.rate_pct >= 10 ? "bar__fill--warn" : "";
            return (
              <tr key={r.facility}>
                <td className="facility">{r.facility}</td>
                <td className="num">{r.canceled}</td>
                <td className="num">{r.total}</td>
                <td>{bar(r.rate_pct, max, variant)}</td>
                <td className="num">{r.rate_pct.toFixed(1)}%</td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </ResultCard>
  );
}

function RevenueTable({ data }) {
  if (data.rows.length === 1) {
    const r = data.rows[0];
    return (
      <ResultCard title={`Revenue — ${r.facility}`} subtitle={data.period}>
        <div className="stats">
          <div className="stat">
            <div className="stat__label">Revenue</div>
            <div className="stat__value">{formatMoney(r.revenue_usd)}</div>
          </div>
          <div className="stat">
            <div className="stat__label">Completed trips</div>
            <div className="stat__value">{r.completed_trips.toLocaleString()}</div>
          </div>
          <div className="stat">
            <div className="stat__label">Avg trip</div>
            <div className="stat__value">{formatMoney(r.avg_trip_usd)}</div>
          </div>
        </div>
      </ResultCard>
    );
  }
  const max = Math.max(...data.rows.map(r => r.revenue_usd), 1);
  return (
    <ResultCard title="Revenue by facility" subtitle={`${data.period} • completed trips only`}>
      <table className="tbl">
        <thead>
          <tr>
            <th>Facility</th>
            <th className="num">Revenue</th>
            <th>Share</th>
            <th className="num">Trips</th>
            <th className="num">Avg / trip</th>
          </tr>
        </thead>
        <tbody>
          {data.rows.map(r => (
            <tr key={r.facility}>
              <td className="facility">{r.facility}</td>
              <td className="num">{formatMoney(r.revenue_usd)}</td>
              <td>{bar(r.revenue_usd, max)}</td>
              <td className="num">{r.completed_trips}</td>
              <td className="num">{formatMoney(r.avg_trip_usd)}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </ResultCard>
  );
}

function ServiceMix({ data }) {
  return (
    <ResultCard title={`Service mix — ${data.scope}`} subtitle={`${data.period} • completed trips`}>
      <div className="mix">
        {data.rows.map(r => (
          <div className="mix__row" key={r.service_class}>
            <div className="mix__label">{r.label} <span style={{ color: "var(--text-tertiary)", fontWeight: 500, fontSize: 11 }}>· {r.service_class}</span></div>
            <div className="mix__bar">
              <div className={"mix__bar__fill mix__bar__fill--" + r.service_class}
                   style={{ width: r.pct + "%" }} />
            </div>
            <div className="mix__pct">{r.pct.toFixed(1)}% <span style={{ color: "var(--text-tertiary)", fontWeight: 500, fontSize: 11 }}>· {r.completed}</span></div>
          </div>
        ))}
      </div>
    </ResultCard>
  );
}

function FacilitiesDown({ data }) {
  const declining = data.rows.filter(r => (r.change_pct ?? 0) < 0).slice(0, 6);
  const list = declining.length ? declining : data.rows.slice(0, 6);
  return (
    <ResultCard title="Facilities trending down" subtitle={`${data.period} vs ${data.comparison}`}>
      <table className="tbl">
        <thead>
          <tr>
            <th>Facility</th>
            <th className="num">Current</th>
            <th className="num">Prior</th>
            <th className="num">Δ</th>
            <th className="num">Change</th>
          </tr>
        </thead>
        <tbody>
          {list.map(r => {
            const cls = (r.change_pct ?? 0) < 0 ? "delta--neg"
              : (r.change_pct ?? 0) > 0 ? "delta--pos" : "delta--neutral";
            const sign = r.change > 0 ? "+" : "";
            const pctSign = (r.change_pct ?? 0) > 0 ? "+" : "";
            return (
              <tr key={r.facility}>
                <td className="facility">{r.facility}</td>
                <td className="num">{r.current}</td>
                <td className="num">{r.prior}</td>
                <td className={"num " + cls}>{sign}{r.change}</td>
                <td className={"num " + cls}>
                  {r.change_pct === null ? "—" : `${pctSign}${r.change_pct.toFixed(1)}%`}
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </ResultCard>
  );
}

function ResultBlock({ tool, data }) {
  if (!data) return null;
  if (data.error) return <div className="alert">{data.error}</div>;
  switch (tool) {
    case "volume_by_facility": return <VolumeTable data={data} />;
    case "trend":               return <TrendTable data={data} />;
    case "cancellations":       return <CancellationsTable data={data} />;
    case "revenue":             return <RevenueTable data={data} />;
    case "service_mix":         return <ServiceMix data={data} />;
    case "facilities_down":     return <FacilitiesDown data={data} />;
    default:                    return null;
  }
}

/* ───────────────────────── Tool chip ───────────────────────── */
function ToolChip({ tool, args }) {
  const pretty = Object.entries(args || {})
    .filter(([, v]) => v !== null && v !== undefined && v !== "")
    .map(([k, v]) => `${k}: ${typeof v === "string" ? v : JSON.stringify(v)}`)
    .join(", ");
  return (
    <div className="toolchip">
      <span className="toolchip__dot" />
      <span>{tool}</span>
      {pretty && <span className="toolchip__args">({pretty})</span>}
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
      <div className="msg__avatar msg__avatar--assistant" aria-hidden="true">
        <Icon.Sparkle />
      </div>
      <div className="msg__bubble">
        {msg.toolPlan && msg.toolPlan.tool && (
          <ToolChip tool={msg.toolPlan.tool} args={msg.toolPlan.args} />
        )}
        {msg.text && <div className="msg__text">{msg.text}</div>}
        {msg.result && <ResultBlock tool={msg.toolPlan?.tool} data={msg.result} />}
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
function App() {
  const [messages, setMessages] = useState([]); // {id, role, text, toolPlan, result, error}
  const [input, setInput] = useState("");
  const [busy, setBusy] = useState(false);
  const [status, setStatus] = useState("");
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
    ta.style.height = "auto";
    ta.style.height = Math.min(180, ta.scrollHeight) + "px";
  }, [input]);

  const ask = useCallback(async (question) => {
    const q = question.trim();
    if (!q || busy) return;
    setInput("");
    const userId = "u" + Date.now();
    setMessages(m => [...m, { id: userId, role: "user", text: q }]);
    setBusy(true);
    setStatus("Routing your question…");

    try {
      const plan = await planTool(q);

      if (!plan.tool) {
        setMessages(m => [...m, {
          id: "a" + Date.now(),
          role: "assistant",
          text: plan.message || "I can answer questions about facility volume, cancellations, revenue, service mix, and trends. Try one of the suggested prompts.",
        }]);
        return;
      }

      setStatus(`Running ${plan.tool}…`);
      const result = await window.SunStateMock.query({
        tool: plan.tool,
        args: plan.args || {},
      });

      setStatus("Composing answer…");
      let summary = "";
      try {
        summary = await summarize(q, plan, result);
      } catch (e) {
        summary = "Got the data, but couldn't generate a written summary.";
      }

      setMessages(m => [...m, {
        id: "a" + Date.now(),
        role: "assistant",
        text: summary,
        toolPlan: plan,
        result,
      }]);
    } catch (e) {
      setMessages(m => [...m, {
        id: "a" + Date.now(),
        role: "assistant",
        error: "Something went wrong: " + (e.message || String(e)),
      }]);
    } finally {
      setBusy(false);
      setStatus("");
    }
  }, [busy]);

  const onKeyDown = (e) => {
    if (e.key === "Enter" && !e.shiftKey) {
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
            <span>{window.SunStateMock?.tripsCount?.toLocaleString() || "—"} trips indexed</span>
          </div>
          <div className="appHeader__user">
            <div className="appHeader__avatar">{window._sunstateUser?.initials || "?"}</div>
            <span style={{ fontSize: 12, fontWeight: 600, color: "var(--text)" }}>{window._sunstateUser?.displayName || ""}</span>
          </div>
        </div>
      </header>

      <div className="chat">
        <div className="chat__scroll" ref={scrollRef}>
          <div className="chat__inner">
            {!hasMessages && <Welcome onPick={(q) => ask(q)} />}
            {messages.map(m =>
              m.role === "user"
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

ReactDOM.createRoot(document.getElementById("root")).render(<App />);
