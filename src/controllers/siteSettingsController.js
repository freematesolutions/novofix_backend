// controllers/siteSettingsController.js
//
// Endpoints para SiteSetting genérico + helpers específicos por key.
// Por ahora expone únicamente el ajuste 'home_hero_video' (Req 16).

import SiteSetting from '../models/Content/SiteSetting.js';

// ─── Helpers ────────────────────────────────────────────────────────────────

/**
 * Detecta el tipo de provider de video a partir de la URL.
 * Acepta YouTube, Vimeo, Cloudinary y URLs MP4/WebM externas.
 */
function detectVideoProvider(url) {
  if (!url || typeof url !== 'string') return 'external';
  const u = url.toLowerCase();
  if (u.includes('youtube.com/') || u.includes('youtu.be/')) return 'youtube';
  if (u.includes('vimeo.com/')) return 'vimeo';
  if (u.includes('res.cloudinary.com/') || u.includes('cloudinary.com/')) return 'cloudinary';
  return 'external';
}

/**
 * Sanitiza y normaliza el payload del video del Home antes de persistir.
 * Devuelve `{ ok: bool, value?, error? }`.
 */
function normalizeHomeHeroVideoPayload(input) {
  if (!input || typeof input !== 'object') {
    return { ok: false, error: 'Invalid payload' };
  }
  const enabled = Boolean(input.enabled);
  const rawUrl = (input.videoUrl || '').trim();
  const rawPoster = (input.posterUrl || '').trim();
  const cloudinaryId = (input.cloudinaryId || '').trim() || null;
  const titleEs = (input.titleEs || '').trim().slice(0, 200);
  const titleEn = (input.titleEn || '').trim().slice(0, 200);

  if (enabled && !rawUrl) {
    return { ok: false, error: 'videoUrl is required when enabled=true' };
  }

  // Validación básica de URL
  if (rawUrl) {
    try {
      const parsed = new URL(rawUrl);
      if (!['http:', 'https:'].includes(parsed.protocol)) {
        return { ok: false, error: 'Only http(s) URLs allowed for videoUrl' };
      }
    } catch {
      return { ok: false, error: 'Invalid videoUrl' };
    }
  }
  if (rawPoster) {
    try {
      const parsed = new URL(rawPoster);
      if (!['http:', 'https:'].includes(parsed.protocol)) {
        return { ok: false, error: 'Only http(s) URLs allowed for posterUrl' };
      }
    } catch {
      return { ok: false, error: 'Invalid posterUrl' };
    }
  }

  return {
    ok: true,
    value: {
      enabled,
      videoUrl: rawUrl || null,
      posterUrl: rawPoster || null,
      cloudinaryId,
      provider: rawUrl ? detectVideoProvider(rawUrl) : 'external',
      titleEs,
      titleEn
    }
  };
}

const DEFAULT_HOME_HERO_VIDEO = {
  enabled: false,
  videoUrl: null,
  posterUrl: null,
  cloudinaryId: null,
  provider: 'external',
  titleEs: '',
  titleEn: ''
};

// ─── Public ─────────────────────────────────────────────────────────────────

/**
 * GET /api/content/home-video — público, sin auth.
 * Devuelve siempre 200 con shape estable. Si no hay doc o está deshabilitado,
 * devuelve `enabled:false` para que el frontend simplemente no renderice.
 */
async function getPublicHomeHeroVideo(req, res) {
  try {
    const doc = await SiteSetting.findOne({ key: 'home_hero_video' }).lean();
    const value = doc?.value && typeof doc.value === 'object'
      ? { ...DEFAULT_HOME_HERO_VIDEO, ...doc.value }
      : DEFAULT_HOME_HERO_VIDEO;
    // Si está deshabilitado o sin URL, devolvemos shape mínimo
    if (!value.enabled || !value.videoUrl) {
      return res.json({ success: true, data: { enabled: false } });
    }
    return res.json({
      success: true,
      data: {
        enabled: true,
        videoUrl: value.videoUrl,
        posterUrl: value.posterUrl,
        provider: value.provider,
        titleEs: value.titleEs,
        titleEn: value.titleEn,
        updatedAt: doc?.updatedAt || null
      }
    });
  } catch (err) {
    console.error('[siteSettings] getPublicHomeHeroVideo error:', err.message);
    // Nunca rompemos el Home por esto: devolvemos disabled.
    return res.json({ success: true, data: { enabled: false } });
  }
}

// ─── Admin ──────────────────────────────────────────────────────────────────

/**
 * GET /api/admin/site-settings/home-video — admin only.
 * Devuelve el doc completo para que el editor pre-llene los campos.
 */
async function getAdminHomeHeroVideo(req, res) {
  try {
    const doc = await SiteSetting.findOne({ key: 'home_hero_video' }).lean();
    const value = doc?.value && typeof doc.value === 'object'
      ? { ...DEFAULT_HOME_HERO_VIDEO, ...doc.value }
      : DEFAULT_HOME_HERO_VIDEO;
    return res.json({
      success: true,
      data: {
        key: 'home_hero_video',
        value,
        updatedAt: doc?.updatedAt || null,
        updatedBy: doc?.updatedBy || null
      }
    });
  } catch (err) {
    console.error('[siteSettings] getAdminHomeHeroVideo error:', err.message);
    return res.status(500).json({ success: false, message: 'Error loading setting' });
  }
}

/**
 * PUT /api/admin/site-settings/home-video — admin only.
 * Body: { enabled, videoUrl, posterUrl, cloudinaryId?, titleEs?, titleEn? }
 */
async function updateHomeHeroVideo(req, res) {
  try {
    const norm = normalizeHomeHeroVideoPayload(req.body);
    if (!norm.ok) {
      return res.status(400).json({ success: false, message: norm.error });
    }
    const doc = await SiteSetting.findOneAndUpdate(
      { key: 'home_hero_video' },
      {
        $set: {
          value: norm.value,
          updatedBy: req.user?._id || null
        },
        $setOnInsert: { key: 'home_hero_video' }
      },
      { new: true, upsert: true, setDefaultsOnInsert: true }
    ).lean();

    return res.json({
      success: true,
      data: {
        key: doc.key,
        value: doc.value,
        updatedAt: doc.updatedAt,
        updatedBy: doc.updatedBy
      }
    });
  } catch (err) {
    console.error('[siteSettings] updateHomeHeroVideo error:', err.message);
    return res.status(500).json({ success: false, message: 'Error saving setting' });
  }
}

export default {
  getPublicHomeHeroVideo,
  getAdminHomeHeroVideo,
  updateHomeHeroVideo
};
