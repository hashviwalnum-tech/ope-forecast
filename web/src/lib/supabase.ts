import { createClient } from '@supabase/supabase-js'

const supabaseUrl = import.meta.env.VITE_SUPABASE_URL as string | undefined
const supabaseKey = import.meta.env.VITE_SUPABASE_ANON_KEY as string | undefined

if (!supabaseUrl || !supabaseKey) {
  const root = document.getElementById('root')
  if (root) {
    root.innerHTML = `
      <div style="font-family:sans-serif;padding:2rem;color:#1e293b;max-width:32rem;margin:4rem auto;background:#f0fdfa;border:2px solid #99f6e4;border-radius:1rem">
        <h2 style="color:#0f766e;margin-top:0">Setup needed</h2>
        <p>Create the file <code style="background:#e0f2fe;padding:2px 6px;border-radius:4px">web/.env</code> in the project folder with these two lines, then restart the frontend server:</p>
        <pre style="background:#1e293b;color:#e2e8f0;padding:1rem;border-radius:0.5rem;font-size:0.85rem;overflow:auto">VITE_SUPABASE_URL=https://your-project.supabase.co
VITE_SUPABASE_ANON_KEY=your-anon-key</pre>
        <p style="font-size:0.85rem;color:#64748b">Both values are on your Supabase Dashboard → Settings → API.</p>
      </div>`
  }
  throw new Error('Missing VITE_SUPABASE_URL or VITE_SUPABASE_ANON_KEY — create web/.env and restart npm run dev')
}

export const supabase = createClient(supabaseUrl, supabaseKey)
