import pg from 'pg';
const { Client } = pg;

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

export default async function handler(req, res) {
  const authed = await verifySession(req.headers['authorization']);
  if (!authed) return res.status(401).json({ error: 'Not authenticated' });

  const client = new Client({
    host:     process.env.AGENT_DB_HOST,
    port:     parseInt(process.env.AGENT_DB_PORT) || 5432,
    database: process.env.AGENT_DB_NAME,
    user:     process.env.AGENT_DB_USER,
    password: process.env.AGENT_DB_PASSWORD,
    ssl: { rejectUnauthorized: false },
    connectionTimeoutMillis: 5000,
  });

  try {
    await client.connect();
    const result = await client.query(
      'SELECT COUNT(*) AS count FROM completed_trips_for_reports'
    );
    const count = parseInt(result.rows[0].count, 10);
    return res.status(200).json({ count });
  } catch (err) {
    return res.status(500).json({ error: err.message });
  } finally {
    await client.end().catch(() => {});
  }
}
