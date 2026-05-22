// Returns public client-side config from env vars.
// Anon key is safe in the browser — RLS enforces access control.
// Service role key is never returned here.
export default function handler(req, res) {
  const { SUPABASE_URL, SUPABASE_ANON_KEY } = process.env;
  if (!SUPABASE_URL || !SUPABASE_ANON_KEY) {
    return res.status(500).json({ error: 'Supabase env vars not configured' });
  }
  res.status(200).json({ supabaseUrl: SUPABASE_URL, supabaseAnonKey: SUPABASE_ANON_KEY });
}
