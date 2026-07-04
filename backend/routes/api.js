import express from 'express';
import { calculateWaterwayRisk } from '../services/riskCalculator.js';
import { createClient } from '@supabase/supabase-js';
import ws from 'ws';

const router = express.Router();

let supabaseInstance = null;

function getSupabaseClient() {
  if (!supabaseInstance) {
    supabaseInstance = createClient(
      process.env.SUPABASE_URL,
      process.env.SUPABASE_SERVICE_ROLE_KEY,
      {
        auth: { persistSession: false },
        realtime: { transport: ws }
      }
    );
  }
  return supabaseInstance;
}

// POST /api/risk
router.post('/risk', async (req, res) => {
  const { lat, lng, plotName } = req.body || {};

  if (typeof lat !== 'number' || typeof lng !== 'number') {
    return res.status(400).json({ 
      success: false, 
      error: 'lat and lng must be valid numbers' 
    });
  }

  try {
    const result = await calculateWaterwayRisk(lat, lng);
    
    return res.json({
      success: true,
      ...result,
      plotName: plotName || null
    });
  } catch (err) {
    console.error('Risk calculation error:', err);
    return res.status(500).json({ 
      success: false, 
      error: 'Risk calculation failed. Please try again.' 
    });
  }
});

// POST /api/checks - Save user check history
router.post('/checks', async (req, res) => {
  const { user_id, lat, lng, result } = req.body || {};

  if (!process.env.SUPABASE_URL || !process.env.SUPABASE_SERVICE_ROLE_KEY) {
    return res.status(501).json({ 
      success: false, 
      error: 'Database not configured on server' 
    });
  }

  try {
    const supabase = getSupabaseClient();

    const payload = {
      user_id: user_id || null,
      lat,
      lng,
      result,
      created_at: new Date().toISOString()
    };

    const { data, error } = await supabase
      .from('checks')
      .insert(payload)
      .select();

    if (error) throw error;

    return res.json({ 
      success: true, 
      saved: true, 
      data 
    });
  } catch (err) {
    console.error('Saving check failed:', err);
    return res.status(500).json({ 
      success: false, 
      error: 'Failed to save check' 
    });
  }
});

// GET /api/history - Get check history from Supabase
router.get('/history', async (req, res) => {
  if (!process.env.SUPABASE_URL || !process.env.SUPABASE_SERVICE_ROLE_KEY) {
    return res.status(501).json({ 
      success: false, 
      error: 'Database not configured on server' 
    });
  }

  try {
    const supabase = getSupabaseClient();

    const { data, error } = await supabase
      .from('checks')
      .select('*')
      .order('created_at', { ascending: false })
      .limit(50);

    if (error) throw error;

    return res.json({ 
      success: true, 
      data 
    });
  } catch (err) {
    console.error('Fetching checks history failed:', err);
    return res.status(500).json({ 
      success: false, 
      error: 'Failed to fetch check history' 
    });
  }
});

export default router;