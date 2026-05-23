// Sun State Transportation — text-to-SQL data agent endpoint.
// Auth: Supabase JWT verified server-side (same pattern as api/claude.js).
// DB: read-only pg connection against completed_trips_for_reports view.
// PHI: never returned; Bambi PHI stripped before any processing.

import pg from 'pg';
const { Client } = pg;

/* ── Auth ──────────────────────────────────────────────────────────── */
async function verifySession(authHeader) {
  if (!authHeader?.startsWith('Bearer ')) return false;
  const token = authHeader.slice(7);
  const resp = await fetch(`${process.env.SUPABASE_URL}/auth/v1/user`, {
    headers: {
      'Authorization': `Bearer ${token}`,
      'apikey': process.env.SUPABASE_ANON_KEY,
    },
  });
  return resp.ok;
}

/* ── DB helpers ────────────────────────────────────────────────────── */
function dbConfig() {
  return {
    host: process.env.AGENT_DB_HOST,
    port: parseInt(process.env.AGENT_DB_PORT) || 5432,
    database: process.env.AGENT_DB_NAME,
    user: process.env.AGENT_DB_USER,
    password: process.env.AGENT_DB_PASSWORD,
    ssl: { rejectUnauthorized: false },
    connectionTimeoutMillis: 8000,
    statement_timeout: 15000,
  };
}

/**
 * guardSQL(sql) — returns an error string if blocked, null if allowed.
 * On success returns the (possibly LIMIT-appended) SQL string.
 */
function guardSQL(sql) {
  if (!sql || typeof sql !== 'string') return { error: 'No SQL provided.' };

  const trimmed = sql.trim();

  // Must start with SELECT or WITH
  if (!/^(SELECT|WITH)\s/i.test(trimmed)) {
    return { error: 'Only SELECT or WITH queries are allowed.' };
  }

  // Strip trailing semicolon, then reject remaining semicolons (multi-statement)
  const noTrailingSemi = trimmed.replace(/;\s*$/, '');
  if (noTrailingSemi.includes(';')) {
    return { error: 'Multi-statement queries are not allowed.' };
  }

  // Reject dangerous DML/DDL keywords as whole words
  const dangerous = ['INSERT', 'UPDATE', 'DELETE', 'DROP', 'ALTER', 'CREATE', 'GRANT', 'REVOKE', 'TRUNCATE', 'COPY'];
  for (const kw of dangerous) {
    if (new RegExp(`\\b${kw}\\b`, 'i').test(noTrailingSemi)) {
      return { error: `Keyword "${kw}" is not allowed in queries.` };
    }
  }

  // Reject system catalog access
  if (/\bpg_/i.test(noTrailingSemi)) {
    return { error: 'Access to pg_ system catalogs is not allowed.' };
  }

  // Reject information_schema access
  if (/\binformation_schema\b/i.test(noTrailingSemi)) {
    return { error: 'Access to information_schema is not allowed.' };
  }

  // Auto-append LIMIT 1000 if no LIMIT clause present
  const finalSQL = /\bLIMIT\b/i.test(noTrailingSemi)
    ? noTrailingSemi
    : noTrailingSemi + ' LIMIT 1000';

  return { sql: finalSQL };
}

async function runQuery(sql) {
  const guard = guardSQL(sql);
  if (guard.error) {
    return { error: guard.error };
  }
  const finalSql = guard.sql;

  const client = new Client(dbConfig());
  try {
    await client.connect();
    const result = await client.query(finalSql);
    return { rows: result.rows, rowCount: result.rowCount, sql: finalSql };
  } catch (err) {
    const isTimeout = err.code === '57014' || /statement timeout|query timeout/i.test(err.message || '');
    const isConnErr = err.code === 'ECONNREFUSED' || err.code === 'ENOTFOUND' || err.code === 'ETIMEDOUT';
    const friendly = isTimeout
      ? 'That query took too long — try narrowing the date range or adding a more specific facility filter.'
      : isConnErr
      ? 'Unable to reach the database right now. Please try again in a moment.'
      : err.message || 'Database error';
    return { error: friendly, sql: finalSql };
  } finally {
    await client.end().catch(() => {});
  }
}

/* ── Bambi live-trip helpers ───────────────────────────────────────── */
async function getBambiToken() {
  const resp = await fetch('https://api.hibambi.com/partners/oauth2/token/', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      grant_type: 'client_credentials',
      client_id: process.env.BAMBI_CLIENT_ID,
      client_secret: process.env.BAMBI_CLIENT_SECRET,
    }),
  });
  if (!resp.ok) throw new Error(`Bambi OAuth failed: ${resp.status}`);
  return (await resp.json()).access_token;
}

const PHI_FIELDS = [
  'passenger_name', 'first_name', 'last_name', 'dob', 'date_of_birth',
  'email', 'phone', 'phone_number', 'dispatcher_notes',
  'has_infectious_disease', 'notes', 'medical_notes',
];
const ADDRESS_KEEP = ['city', 'state', 'zip', 'postal_code', 'lat', 'latitude', 'lng', 'longitude'];
const ADDRESS_FIELDS = ['pickup_address', 'dropoff_address'];

function stripPHI(trip) {
  const cleaned = { ...trip };
  // Remove direct PHI fields
  for (const f of PHI_FIELDS) {
    delete cleaned[f];
  }
  // Scrub address objects — keep only safe sub-fields
  for (const af of ADDRESS_FIELDS) {
    if (cleaned[af] && typeof cleaned[af] === 'object') {
      const addr = cleaned[af];
      const safe = {};
      for (const k of ADDRESS_KEEP) {
        if (addr[k] !== undefined) safe[k] = addr[k];
      }
      cleaned[af] = safe;
    } else if (typeof cleaned[af] === 'string') {
      // String address — drop entirely (could be full street address)
      delete cleaned[af];
    }
  }
  return cleaned;
}

async function getLiveTrips(lookbackHours, callCountInSession) {
  if (callCountInSession >= 2) {
    return {
      capped: true,
      message: 'Live data cap reached (2 calls per session). Use warehouse data to answer this question instead.',
    };
  }

  const hours = Math.min(lookbackHours, 48);
  const since = new Date(Date.now() - hours * 60 * 60 * 1000).toISOString();

  try {
    const token = await getBambiToken();
    const resp = await fetch(
      `https://api.hibambi.com/partners/trips/?organization_id=01951a47-0173-a814-28f9-a2fc4e703d76&since=${encodeURIComponent(since)}`,
      { headers: { Authorization: `Bearer ${token}` } }
    );
    if (!resp.ok) throw new Error(`Bambi trips API failed: ${resp.status}`);
    const raw = await resp.json();
    const trips = Array.isArray(raw) ? raw : (raw.results || raw.trips || []);

    // PHI strip BEFORE any processing
    const stripped = trips.map(stripPHI);

    // Aggregate by facility + service_class + status — never return raw rows
    const counts = {};
    for (const t of stripped) {
      const key = `${t.facility || 'Unknown'}||${t.service_class || 'Unknown'}||${t.status || 'Unknown'}`;
      if (!counts[key]) {
        counts[key] = {
          facility: t.facility || 'Unknown',
          service_class: t.service_class || 'Unknown',
          status: t.status || 'Unknown',
          count: 0,
        };
      }
      counts[key].count++;
    }

    return {
      lookback_hours: hours,
      as_of: new Date().toISOString(),
      total_trips: stripped.length,
      summary: Object.values(counts),
    };
  } catch (err) {
    return { error: err.message || 'Failed to fetch live trips' };
  }
}

/* ── Claude agent loop ─────────────────────────────────────────────── */
const SYSTEM_PROMPT = `You are a read-only data analyst for Sun State Transportation, a non-emergency medical transport company. You answer questions by writing PostgreSQL SELECT queries against ONE view: completed_trips_for_reports. Columns: "Date" (timestamptz, scheduled pickup), "Facility" (text), "Status" (text), "Space Type" (text), service_class (STR=stretcher, WC=wheelchair, AMB=ambulatory, OTHER), status_raw (completed|canceled|…), facility_raw, scheduled_pickup_at, trip_created_at, price_cents (integer; divide by 100 for dollars), distance_miles, driver_name, is_will_call (bool), lead_time_days. Mixed-case column names must be double-quoted in SQL. Business context: stretcher (STR) volume is the primary revenue signal; org baseline cancellation rate ≈20.6%; average lead time ≈3.9 days; ~65 facilities; data spans March 2025 to present. Completed trips = status_raw='completed'; cancellations = status_raw='canceled'. Rules: SELECT only; query only this view; never attempt to modify data; always state the time window in your answer; present dollars not cents; round sensibly; if the data can't answer a question, say so plainly rather than guessing. Default to warehouse SQL; only use get_live_trips when the user explicitly asks for live/today/now data that requires sub-hour freshness.

CANCELLATION RATE — mandatory formula (non-negotiable): always compute as 100.0 * count(*) FILTER (WHERE status_raw='canceled') / NULLIF(count(*) FILTER (WHERE status_raw IN ('completed','canceled')), 0). The denominator is resolved trips only (completed + canceled) — never COUNT(*) over all statuses, which understates the rate by including scheduled/no-show rows. The org baseline of 20.6% was computed this way; all facility rates must use the same formula to be comparable.

After running a query, call provide_visualization when the data suits it:
- Weekly/monthly time series → type "area", xKey = date column, series = numeric column(s) to plot
- Facility rankings / comparisons (top N, biggest drops) → type "bar", xKey = facility/name column, one series for the metric
- Service mix (STR/WC/AMB) → type "donut", xKey = label column, series = [{name:"Trips", dataKey: count column}]
- For any answer with 2–4 headline numbers (totals, rates, averages), include them in the stats array as [{label, value, delta?}] where delta is a string like "+12%" or "-3 trips"
- Skip provide_visualization for simple single-sentence answers with no tabular data
- Always include the full data array (not just a sample) in the chart spec`;

const TOOLS = [
  {
    name: 'run_readonly_query',
    description: 'Execute a read-only PostgreSQL SELECT query against the completed_trips_for_reports view. Use this for all historical/warehouse questions.',
    input_schema: {
      type: 'object',
      properties: {
        sql: { type: 'string', description: 'A PostgreSQL SELECT or WITH query.' },
      },
      required: ['sql'],
    },
  },
  {
    name: 'get_live_trips',
    description: 'Fetch live Bambi trip data. ONLY use when user explicitly asks for live / right-now / today data that the hourly-refreshed warehouse would not have yet. Max 2 calls per session.',
    input_schema: {
      type: 'object',
      properties: {
        lookback_hours: { type: 'number', description: 'Hours of data to fetch (max 48).' },
      },
      required: ['lookback_hours'],
    },
  },
  {
    name: 'provide_visualization',
    description: 'Call after run_readonly_query to supply chart specs and/or stat tiles for the UI. Optional — only call when a chart or headline stats genuinely help.',
    input_schema: {
      type: 'object',
      properties: {
        stats: {
          type: 'array',
          description: '2–4 headline metric tiles shown above the answer.',
          items: {
            type: 'object',
            properties: {
              label: { type: 'string' },
              value: { type: 'string' },
              delta: { type: 'string', description: 'Optional change string, e.g. "+12%" or "-3 trips"' },
            },
            required: ['label', 'value'],
          },
        },
        chart: {
          type: 'object',
          properties: {
            type: { type: 'string', enum: ['line', 'area', 'bar', 'donut'] },
            title: { type: 'string' },
            xKey: { type: 'string', description: 'Data key for x-axis / category label' },
            series: {
              type: 'array',
              items: {
                type: 'object',
                properties: {
                  name: { type: 'string' },
                  dataKey: { type: 'string' },
                  color: { type: 'string' },
                },
                required: ['name', 'dataKey'],
              },
            },
            data: { type: 'array', description: 'Full data array for the chart.' },
          },
          required: ['type', 'xKey', 'series', 'data'],
        },
      },
    },
  },
];

function countLiveTripCalls(messages) {
  let count = 0;
  for (const msg of messages) {
    if (msg.role === 'assistant' && Array.isArray(msg.content)) {
      for (const block of msg.content) {
        if (block.type === 'tool_use' && block.name === 'get_live_trips') {
          count++;
        }
      }
    }
  }
  return count;
}

async function runAgentLoop(messages) {
  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) throw new Error('ANTHROPIC_API_KEY not configured');

  let loopMessages = [...messages];
  let lastSQL = null;
  let lastRows = null;
  let lastChart = null;
  let lastStats = null;
  const MAX_ITERATIONS = 8;

  for (let i = 0; i < MAX_ITERATIONS; i++) {
    const resp = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': apiKey,
        'anthropic-version': '2023-06-01',
      },
      body: JSON.stringify({
        model: 'claude-sonnet-4-6',
        max_tokens: 4096,
        system: SYSTEM_PROMPT,
        tools: TOOLS,
        messages: loopMessages,
      }),
    });

    if (!resp.ok) {
      const errBody = await resp.json().catch(() => ({}));
      throw new Error(errBody.error?.message || `Anthropic API error ${resp.status}`);
    }

    const data = await resp.json();

    if (data.stop_reason === 'end_turn') {
      const textBlock = data.content.find(b => b.type === 'text');
      const text = textBlock?.text || '';
      return { text, sql: lastSQL, rows: lastRows, chart: lastChart, stats: lastStats };
    }

    if (data.stop_reason === 'tool_use') {
      // Append assistant message with full content
      loopMessages.push({ role: 'assistant', content: data.content });

      // Execute each tool call and collect results
      const toolResults = [];
      const liveTripCallsSoFar = countLiveTripCalls(loopMessages);

      for (const block of data.content) {
        if (block.type !== 'tool_use') continue;

        let toolResult;
        if (block.name === 'run_readonly_query') {
          const qResult = await runQuery(block.input.sql);
          if (!qResult.error) {
            lastSQL = qResult.sql;
            lastRows = qResult.rows;
          }
          toolResult = JSON.stringify(qResult);
        } else if (block.name === 'get_live_trips') {
          const liveResult = await getLiveTrips(
            block.input.lookback_hours,
            liveTripCallsSoFar
          );
          toolResult = JSON.stringify(liveResult);
        } else if (block.name === 'provide_visualization') {
          if (block.input.chart) lastChart = block.input.chart;
          if (block.input.stats) lastStats = block.input.stats;
          toolResult = JSON.stringify({ ok: true });
        } else {
          toolResult = JSON.stringify({ error: `Unknown tool: ${block.name}` });
        }

        toolResults.push({
          type: 'tool_result',
          tool_use_id: block.id,
          content: toolResult,
        });
      }

      loopMessages.push({ role: 'user', content: toolResults });
      continue;
    }

    // Unexpected stop reason — extract any text and return
    const textBlock = data.content?.find(b => b.type === 'text');
    return {
      text: textBlock?.text || 'Unexpected response from agent.',
      sql: lastSQL, rows: lastRows, chart: lastChart, stats: lastStats,
    };
  }

  return {
    text: 'The agent reached its iteration limit. Try rephrasing.',
    sql: lastSQL, rows: lastRows, chart: lastChart, stats: lastStats,
  };
}

/* ── Handler ───────────────────────────────────────────────────────── */
export default async function handler(req, res) {
  if (req.method !== 'POST') {
    res.setHeader('Allow', 'POST');
    return res.status(405).end('Method Not Allowed');
  }

  const authed = await verifySession(req.headers['authorization']);
  if (!authed) return res.status(401).json({ error: 'Not authenticated' });

  const { messages } = req.body || {};
  if (!Array.isArray(messages) || messages.length === 0) {
    return res.status(400).json({ error: 'messages array is required and must be non-empty' });
  }

  try {
    const result = await runAgentLoop(messages);
    return res.status(200).json(result);
  } catch (err) {
    return res.status(500).json({ error: err.message || 'Internal server error' });
  }
}

export const config = { maxDuration: 60 };
