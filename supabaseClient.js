const { createClient } = require('@supabase/supabase-js');

// ----------------------------------------------------
// Environment Variables & Initialization
// ----------------------------------------------------
const rawUrl = (process.env.SUPABASE_URL || '').trim().replace(/\/+$/, '');
const SUPABASE_URL = rawUrl.replace(/\/rest\/v1\/?$/, '');
const SUPABASE_KEY = (process.env.SUPABASE_KEY || process.env.SUPABASE_ANON_KEY || process.env.SUPABASE_SERVICE_ROLE_KEY || '').trim();
const BUCKET_NAME = (process.env.SUPABASE_BUCKET || 'mediaart-assets').trim();


let supabase = null;
let isConfigured = false;

if (SUPABASE_URL && SUPABASE_KEY) {
  try {
    supabase = createClient(SUPABASE_URL, SUPABASE_KEY, {
      auth: {
        persistSession: false,
        autoRefreshToken: false
      }
    });
    isConfigured = true;
    console.log(`[Supabase] ✅ Connected successfully to: ${SUPABASE_URL}`);
  } catch (err) {
    console.error('[Supabase] ❌ Initialization error:', err.message);
    supabase = null;
    isConfigured = false;
  }
} else {
  console.log('[Supabase] ℹ️ SUPABASE_URL or SUPABASE_KEY not provided. Running in local fallback mode.');
}

function isSupabaseConfigured() {
  return isConfigured && supabase !== null;
}

function getSupabaseClient() {
  return supabase;
}

// ----------------------------------------------------
// Storage Helpers: Upload Base64 Data URL to Supabase Storage
// ----------------------------------------------------
/**
 * Uploads a Data URL (base64 image) or raw binary buffer to Supabase Storage.
 * Returns the public CDN URL. If input is already an http/https URL, returns it as-is.
 */
async function uploadDataUrlToStorage(dataUrl, folder, filename) {
  if (!isSupabaseConfigured()) {
    return null;
  }
  if (!dataUrl || typeof dataUrl !== 'string') {
    return null;
  }
  // If already an HTTP(S) URL, no need to upload
  if (dataUrl.startsWith('http://') || dataUrl.startsWith('https://')) {
    return dataUrl;
  }

  try {
    let buffer;
    let contentType = 'image/png';
    let ext = 'png';

    if (dataUrl.startsWith('data:')) {
      const match = dataUrl.match(/^data:([a-zA-Z0-9\/+.-]+);base64,(.+)$/);
      if (match) {
        contentType = match[1];
        buffer = Buffer.from(match[2], 'base64');
        if (contentType.includes('jpeg') || contentType.includes('jpg')) ext = 'jpg';
        else if (contentType.includes('webp')) ext = 'webp';
        else if (contentType.includes('svg')) ext = 'svg';
        else ext = 'png';
      } else {
        // Plain text SVG or encoded SVG data
        const svgMatch = dataUrl.match(/^data:image\/svg\+xml;utf8,(.+)$/);
        if (svgMatch) {
          contentType = 'image/svg+xml';
          ext = 'svg';
          buffer = Buffer.from(decodeURIComponent(svgMatch[1]), 'utf-8');
        } else {
          return null;
        }
      }
    } else {
      // Not a data URL
      return null;
    }

    const cleanFilename = filename.endsWith(`.${ext}`) ? filename : `${filename}.${ext}`;
    const storagePath = `${folder}/${cleanFilename}`;

    const { error: uploadError } = await supabase.storage
      .from(BUCKET_NAME)
      .upload(storagePath, buffer, {
        contentType: contentType,
        upsert: true
      });

    if (uploadError) {
      console.warn(`[Supabase Storage] Upload error for ${storagePath}:`, uploadError.message);
      return null;
    }

    const { data } = supabase.storage.from(BUCKET_NAME).getPublicUrl(storagePath);
    if (data && data.publicUrl) {
      return data.publicUrl;
    }
    return null;
  } catch (err) {
    console.error('[Supabase Storage] Unexpected error in uploadDataUrlToStorage:', err);
    return null;
  }
}

// ----------------------------------------------------
// Database: Templates CRUD
// ----------------------------------------------------
async function dbGetTemplates() {
  if (!isSupabaseConfigured()) return null;
  try {
    const { data, error } = await supabase
      .from('templates')
      .select('*')
      .order('created_at', { ascending: false });

    if (error) {
      console.warn('[Supabase DB] Error fetching templates:', error.message);
      return null;
    }

    return (data || []).map(row => ({
      id: row.id,
      name: row.name,
      icon: row.icon || '🎨',
      motionType: row.motion_type || 'walk',
      imageUrl: row.image_url,
      skeleton: row.skeleton || null,
      isBuiltin: Boolean(row.is_builtin),
      createdAt: Number(row.created_at) || Date.now()
    }));
  } catch (err) {
    console.error('[Supabase DB] getTemplates error:', err.message);
    return null;
  }
}

async function dbAddTemplate(template) {
  if (!isSupabaseConfigured()) return false;
  try {
    const { error } = await supabase
      .from('templates')
      .upsert({
        id: template.id,
        name: template.name,
        icon: template.icon || '🎨',
        motion_type: template.motionType || 'walk',
        image_url: template.imageUrl,
        skeleton: template.skeleton || null,
        is_builtin: Boolean(template.isBuiltin),
        created_at: template.createdAt || Date.now()
      });

    if (error) {
      console.warn('[Supabase DB] Error adding template:', error.message);
      return false;
    }
    return true;
  } catch (err) {
    console.error('[Supabase DB] addTemplate error:', err.message);
    return false;
  }
}

async function dbDeleteTemplate(id) {
  if (!isSupabaseConfigured()) return false;
  try {
    const { error } = await supabase
      .from('templates')
      .delete()
      .eq('id', id);

    if (error) {
      console.warn('[Supabase DB] Error deleting template:', error.message);
      return false;
    }
    return true;
  } catch (err) {
    console.error('[Supabase DB] deleteTemplate error:', err.message);
    return false;
  }
}

// ----------------------------------------------------
// Database: Backgrounds CRUD
// ----------------------------------------------------
async function dbGetBackgrounds() {
  if (!isSupabaseConfigured()) return null;
  try {
    const { data, error } = await supabase
      .from('backgrounds')
      .select('*')
      .order('created_at', { ascending: false });

    if (error) {
      console.warn('[Supabase DB] Error fetching backgrounds:', error.message);
      return null;
    }

    return (data || []).map(row => ({
      id: row.id,
      name: row.name,
      url: row.image_url,
      atmosphere: row.atmosphere || 'sparkle',
      motionType: row.motion_type || 'walk',
      createdAt: Number(row.created_at) || Date.now()
    }));
  } catch (err) {
    console.error('[Supabase DB] getBackgrounds error:', err.message);
    return null;
  }
}

async function dbAddBackground(bg) {
  if (!isSupabaseConfigured()) return false;
  try {
    const { error } = await supabase
      .from('backgrounds')
      .upsert({
        id: bg.id,
        name: bg.name,
        image_url: bg.url,
        atmosphere: bg.atmosphere || 'sparkle',
        motion_type: bg.motionType || 'walk',
        created_at: bg.createdAt || Date.now()
      });

    if (error) {
      console.warn('[Supabase DB] Error adding background:', error.message);
      return false;
    }
    return true;
  } catch (err) {
    console.error('[Supabase DB] addBackground error:', err.message);
    return false;
  }
}

async function dbDeleteBackground(id) {
  if (!isSupabaseConfigured()) return false;
  try {
    const { error } = await supabase
      .from('backgrounds')
      .delete()
      .eq('id', id);

    if (error) {
      console.warn('[Supabase DB] Error deleting background:', error.message);
      return false;
    }
    return true;
  } catch (err) {
    console.error('[Supabase DB] deleteBackground error:', err.message);
    return false;
  }
}

// ----------------------------------------------------
// Database: Admin App Config CRUD
// ----------------------------------------------------
async function dbGetConfig() {
  if (!isSupabaseConfigured()) return null;
  try {
    const { data, error } = await supabase
      .from('app_config')
      .select('config')
      .eq('id', 'default')
      .single();

    if (error) {
      // Record might not exist yet
      return null;
    }
    return data ? data.config : null;
  } catch (err) {
    console.error('[Supabase DB] getConfig error:', err.message);
    return null;
  }
}

async function dbSaveConfig(config) {
  if (!isSupabaseConfigured()) return false;
  try {
    const { error } = await supabase
      .from('app_config')
      .upsert({
        id: 'default',
        config: config,
        updated_at: new Date().toISOString()
      });

    if (error) {
      console.warn('[Supabase DB] Error saving config:', error.message);
      return false;
    }
    return true;
  } catch (err) {
    console.error('[Supabase DB] saveConfig error:', err.message);
    return false;
  }
}

module.exports = {
  isSupabaseConfigured,
  getSupabaseClient,
  uploadDataUrlToStorage,
  dbGetTemplates,
  dbAddTemplate,
  dbDeleteTemplate,
  dbGetBackgrounds,
  dbAddBackground,
  dbDeleteBackground,
  dbGetConfig,
  dbSaveConfig
};
