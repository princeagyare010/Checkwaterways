import express from 'express';
import { calculateWaterwayRisk } from '../services/riskCalculator.js';
import { createClient } from '@supabase/supabase-js';

const router = express.Router();

// POST /api/risk
// Body: { lat: number, lng: number }
router.post('/risk', async (req, res) => {
  const { lat, lng } = req.body || {};
  if (typeof lat !== 'number' || typeof lng !== 'number') {
    return res.status(400).json({ error: 'lat and lng numbers required' });
  }

  try {
    const result = await calculateWaterwayRisk(lat, lng);
    return res.json(result);
  } catch (err) {
    console.error('Risk calculation error:', err);
    return res.status(500).json({ error: 'Risk calculation failed' });
  }
});

// POST /api/checks - save a user check (requires Supabase credentials)
router.post('/checks', async (req, res) => {
  const { user_id, lat, lng, result } = req.body || {};
  if (!process.env.SUPABASE_URL || !process.env.SUPABASE_SERVICE_ROLE_KEY) {
    return res.status(501).json({ error: 'Supabase not configured on server' });
  }

  try {
    const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY);
    const payload = { user_id: user_id || null, lat, lng, result, created_at: new Date().toISOString() };
    const { data, error } = await supabase.from('checks').insert(payload).select();
    if (error) throw error;
    return res.json({ saved: true, data });
  } catch (err) {
    console.error('Saving check failed:', err);
    return res.status(500).json({ error: 'Saving check failed' });
  }
});

export default router;
