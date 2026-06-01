// controllers/cmsController.js
//
// Endpoints públicos y de administración del CMS de contenidos editoriales.
// Las páginas legales (Términos, Privacidad, Sobre Nosotros), Hero, datos de
// contacto y FAQ son editables por el rol admin sin necesidad de redeploy.

import CmsContent, { CMS_CONTENT_KEYS } from '../models/Content/CmsContent.js';
import FaqItem from '../models/Content/FaqItem.js';
import ServiceCategoryOverride from '../models/Content/ServiceCategoryOverride.js';
import { SERVICE_CATEGORIES } from '../config/categories.js';
import {
  renderMarkdownSafe,
  getCachedContent,
  setCachedContent,
  invalidateContentCache,
  getCachedFaq,
  setCachedFaq,
  invalidateFaqCache,
  getCachedServiceCategories,
  setCachedServiceCategories,
  invalidateServiceCategoriesCache
} from '../services/internal/cmsService.js';
import { buildDefaultTranslations } from '../services/internal/cmsDefaults.js';

const CACHE_HEADERS = {
  publicShortLive: 'public, max-age=30, s-maxage=60, stale-while-revalidate=300'
};

// ─── Helpers ────────────────────────────────────────────────────────────────

function ensureDocOrEmpty(key, locale) {
  // Estructura mínima cuando no hay aún documento en BBDD: permite al frontend
  // caer a sus claves i18n hardcoded sin error 404 ruidoso en logs.
  return {
    key,
    locale,
    title: '',
    sections: [],
    lastEditedAt: null,
    version: 0,
    empty: true
  };
}

// ─── PÚBLICO ────────────────────────────────────────────────────────────────

/**
 * GET /api/content/:key?locale=es
 * Devuelve el contenido público listo para renderizar. Cache 60s en Redis +
 * stale-while-revalidate en CDN/edge.
 */
async function getPublicContent(req, res) {
  try {
    const { key } = req.params;
    const locale = req.query.locale || 'es';

    if (!CMS_CONTENT_KEYS.includes(key)) {
      return res.status(404).json({ success: false, message: 'Content key not found' });
    }

    // 1) Cache hit
    const cached = await getCachedContent(key, locale);
    if (cached) {
      res.set('Cache-Control', CACHE_HEADERS.publicShortLive);
      return res.json({ success: true, data: cached });
    }

    // 2) BBDD
    const doc = await CmsContent.findOne({ key }).lean({ virtuals: false });
    let payload;
    if (!doc) {
      payload = ensureDocOrEmpty(key, locale);
    } else {
      // Reconstruimos el método de instancia ya que usamos .lean()
      payload = buildPublicPayloadFromLean(doc, locale);
    }

    await setCachedContent(key, locale, payload);
    res.set('Cache-Control', CACHE_HEADERS.publicShortLive);
    return res.json({ success: true, data: payload });
  } catch (error) {
    console.error('CmsController - getPublicContent error:', error);
    return res.status(500).json({ success: false, message: 'Failed to load content' });
  }
}

function buildPublicPayloadFromLean(doc, locale) {
  const safeLocale = ['es', 'en'].includes(locale) ? locale : 'es';
  const primary = doc.translations?.[safeLocale];
  const hasPrimary = primary && (primary.title || (primary.sections && primary.sections.length));
  const fallbackLocale = safeLocale === 'es' ? 'en' : 'es';
  const source = hasPrimary ? primary : doc.translations?.[fallbackLocale] || {};

  return {
    key: doc.key,
    locale: safeLocale,
    title: source.title || '',
    sections: (source.sections || []).map((s) => ({
      id: s.id,
      label: s.label,
      bodyHtml: s.bodyHtml
    })),
    lastEditedAt: source.lastEditedAt || doc.publishedAt,
    version: doc.version,
    ...(hasPrimary ? {} : { fallbackUsed: fallbackLocale })
  };
}

/**
 * GET /api/content/faq?locale=es&category=all
 * Lista pública de FAQ activas, ordenadas por `order`. Cache 60s.
 */
async function getPublicFaq(req, res) {
  try {
    const locale = req.query.locale || 'es';
    const category = req.query.category || 'all';

    const cached = await getCachedFaq(locale, category);
    if (cached) {
      res.set('Cache-Control', CACHE_HEADERS.publicShortLive);
      return res.json({ success: true, data: cached });
    }

    const filter = { active: true };
    if (category !== 'all') filter.category = category;

    const docs = await FaqItem.find(filter).sort({ order: 1, createdAt: 1 }).lean();
    const items = docs.map((d) => {
      const safeLocale = ['es', 'en'].includes(locale) ? locale : 'es';
      const fallbackLocale = safeLocale === 'es' ? 'en' : 'es';
      const pick = (field) =>
        (d[field]?.[safeLocale] && d[field][safeLocale].trim()) ||
        d[field]?.[fallbackLocale] ||
        '';
      return {
        id: String(d._id),
        question: pick('question'),
        answerHtml: pick('answerHtml'),
        category: d.category,
        order: d.order
      };
    });

    const payload = { items, total: items.length, category };
    await setCachedFaq(locale, category, payload);
    res.set('Cache-Control', CACHE_HEADERS.publicShortLive);
    return res.json({ success: true, data: payload });
  } catch (error) {
    console.error('CmsController - getPublicFaq error:', error);
    return res.status(500).json({ success: false, message: 'Failed to load FAQ' });
  }
}

// ─── ADMIN ──────────────────────────────────────────────────────────────────

/**
 * GET /api/admin/cms/contents
 * Lista resumida de todos los contenidos editables (existan o no en BBDD).
 * Garantiza que el admin vea las 5 claves aunque aún no se hayan sembrado.
 */
async function listContents(_req, res) {
  try {
    const docs = await CmsContent.find({}, { history: 0 }).lean();
    const byKey = new Map(docs.map((d) => [d.key, d]));

    const items = CMS_CONTENT_KEYS.map((key) => {
      const doc = byKey.get(key);
      return {
        key,
        exists: Boolean(doc),
        version: doc?.version || 0,
        publishedAt: doc?.publishedAt || null,
        editedBy: doc?.editedBy || null,
        locales: {
          es: {
            hasContent: Boolean(doc?.translations?.es?.title),
            lastEditedAt: doc?.translations?.es?.lastEditedAt || null
          },
          en: {
            hasContent: Boolean(doc?.translations?.en?.title),
            lastEditedAt: doc?.translations?.en?.lastEditedAt || null
          }
        }
      };
    });

    return res.json({ success: true, data: { items } });
  } catch (error) {
    console.error('CmsController - listContents error:', error);
    return res.status(500).json({ success: false, message: 'Failed to list contents' });
  }
}

/**
 * GET /api/admin/cms/contents/:key
 * Devuelve el documento completo (sin historial expandido para mantener payload chico).
 * Incluye Markdown fuente para que el admin edite.
 */
async function getContentForAdmin(req, res) {
  try {
    const { key } = req.params;
    const doc = await CmsContent.findOne({ key }).lean();
    if (!doc) {
      return res.json({
        success: true,
        data: {
          key,
          version: 0,
          publishedAt: null,
          translations: { es: { title: '', sections: [] }, en: { title: '', sections: [] } },
          history: []
        }
      });
    }
    // Histórico viene resumido: ids, versiones, fechas, autores (sin payload pesado)
    const historySummary = (doc.history || []).map((h) => ({
      version: h.version,
      locale: h.locale,
      editedAt: h.editedAt,
      editedBy: h.editedBy,
      titleSnapshot: h.titleSnapshot,
      sectionsCount: (h.sectionsSnapshot || []).length
    }));
    return res.json({
      success: true,
      data: { ...doc, history: historySummary }
    });
  } catch (error) {
    console.error('CmsController - getContentForAdmin error:', error);
    return res.status(500).json({ success: false, message: 'Failed to load content' });
  }
}

/**
 * GET /api/admin/cms/contents/:key/history/:version
 * Devuelve el snapshot completo de una versión histórica concreta.
 */
async function getHistoryEntry(req, res) {
  try {
    const { key } = req.params;
    const version = Number(req.params.version);
    const doc = await CmsContent.findOne({ key }).lean();
    if (!doc) return res.status(404).json({ success: false, message: 'Content not found' });

    const entry = (doc.history || []).find((h) => h.version === version);
    if (!entry) return res.status(404).json({ success: false, message: 'History entry not found' });

    return res.json({ success: true, data: entry });
  } catch (error) {
    console.error('CmsController - getHistoryEntry error:', error);
    return res.status(500).json({ success: false, message: 'Failed to load history entry' });
  }
}

/**
 * PUT /api/admin/cms/contents/:key
 * Publica una nueva versión del contenido en el locale indicado.
 * Body: { locale, title, sections: [{ id, label, bodyMarkdown }] }
 */
async function updateContent(req, res) {
  try {
    const { key } = req.params;
    const { locale, title, sections } = req.body;

    // Renderizar y sanitizar cada sección antes de persistir
    const sectionsToStore = (sections || []).map((s) => ({
      id: s.id,
      label: s.label || '',
      bodyMarkdown: s.bodyMarkdown || '',
      bodyHtml: renderMarkdownSafe(s.bodyMarkdown || '')
    }));

    const now = new Date();
    let doc = await CmsContent.findOne({ key });
    const isFirstPublish = !doc;

    if (!doc) {
      doc = new CmsContent({
        key,
        translations: {
          es: { title: '', sections: [] },
          en: { title: '', sections: [] }
        },
        version: 1
      });
    }

    // Guardar snapshot anterior en historial antes de sobreescribir
    const previousLocale = doc.translations?.[locale];
    if (previousLocale && (previousLocale.title || (previousLocale.sections && previousLocale.sections.length))) {
      doc.pushHistory({
        version: doc.version,
        locale,
        titleSnapshot: previousLocale.title,
        sectionsSnapshot: previousLocale.sections,
        editedBy: doc.editedBy,
        editedAt: now
      });
    }

    doc.translations[locale] = {
      title,
      sections: sectionsToStore,
      lastEditedAt: now
    };
    // En el primer PUT real (doc recién creado) la versión queda en 1.
    // En PUTs posteriores incrementamos.
    doc.version = isFirstPublish ? 1 : (doc.version || 0) + 1;
    doc.publishedAt = now;
    doc.editedBy = req.user?._id || null;

    await doc.save();
    await invalidateContentCache(key);

    return res.json({
      success: true,
      data: {
        key: doc.key,
        version: doc.version,
        publishedAt: doc.publishedAt,
        locale,
        title,
        sections: sectionsToStore,
        sectionsCount: sectionsToStore.length
      }
    });
  } catch (error) {
    console.error('CmsController - updateContent error:', error);
    return res.status(500).json({ success: false, message: 'Failed to update content' });
  }
}

/**
 * POST /api/admin/cms/contents/:key/rollback/:version
 * Restaura una versión previa, generando una nueva versión (no destruye historial).
 */
async function rollbackContent(req, res) {
  try {
    const { key } = req.params;
    const version = Number(req.params.version);

    const doc = await CmsContent.findOne({ key });
    if (!doc) return res.status(404).json({ success: false, message: 'Content not found' });

    const entry = (doc.history || []).find((h) => h.version === version);
    if (!entry) return res.status(404).json({ success: false, message: 'History entry not found' });

    const now = new Date();
    const targetLocale = entry.locale;

    // Snapshot del estado actual antes de sobreescribir
    const current = doc.translations?.[targetLocale];
    if (current && (current.title || (current.sections && current.sections.length))) {
      doc.pushHistory({
        version: doc.version,
        locale: targetLocale,
        titleSnapshot: current.title,
        sectionsSnapshot: current.sections,
        editedBy: doc.editedBy,
        editedAt: now
      });
    }

    doc.translations[targetLocale] = {
      title: entry.titleSnapshot || '',
      sections: (entry.sectionsSnapshot || []).map((s) => ({
        id: s.id,
        label: s.label || '',
        bodyMarkdown: s.bodyMarkdown || '',
        // Re-sanitizamos por seguridad aunque el snapshot ya esté limpio
        bodyHtml: renderMarkdownSafe(s.bodyMarkdown || '') || s.bodyHtml || ''
      })),
      lastEditedAt: now
    };
    doc.version = (doc.version || 1) + 1;
    doc.publishedAt = now;
    doc.editedBy = req.user?._id || null;

    await doc.save();
    await invalidateContentCache(key);

    return res.json({
      success: true,
      data: { key, version: doc.version, restoredFromVersion: version, locale: targetLocale }
    });
  } catch (error) {
    console.error('CmsController - rollbackContent error:', error);
    return res.status(500).json({ success: false, message: 'Failed to rollback content' });
  }
}

// ─── FAQ Admin ──────────────────────────────────────────────────────────────

async function listFaqAdmin(_req, res) {
  try {
    const docs = await FaqItem.find({}).sort({ order: 1, createdAt: 1 }).lean();
    const items = docs.map((d) => ({ ...d, id: String(d._id) }));
    return res.json({ success: true, data: { items, total: items.length } });
  } catch (error) {
    console.error('CmsController - listFaqAdmin error:', error);
    return res.status(500).json({ success: false, message: 'Failed to list FAQ' });
  }
}

async function createFaq(req, res) {
  try {
    const { question, answerMarkdown, category, order, active } = req.body;
    const computedOrder = typeof order === 'number'
      ? order
      : await getNextOrder(category);

    const doc = await FaqItem.create({
      question,
      answerMarkdown,
      answerHtml: {
        es: renderMarkdownSafe(answerMarkdown?.es || ''),
        en: renderMarkdownSafe(answerMarkdown?.en || '')
      },
      category: category || 'general',
      order: computedOrder,
      active: active !== false,
      editedBy: req.user?._id || null
    });

    await invalidateFaqCache();
    return res.status(201).json({ success: true, data: serializeFaq(doc) });
  } catch (error) {
    console.error('CmsController - createFaq error:', error);
    return res.status(500).json({ success: false, message: 'Failed to create FAQ' });
  }
}

// Serializa una FAQ con `id` plano y los bloques bilingües completos para
// que el panel admin pueda mostrar ES y EN sin un round-trip adicional.
function serializeFaq(doc) {
  const obj = typeof doc.toObject === 'function' ? doc.toObject() : doc;
  return {
    id: String(obj._id),
    category: obj.category,
    order: obj.order,
    active: obj.active,
    question: obj.question,
    answerMarkdown: obj.answerMarkdown,
    answerHtml: obj.answerHtml,
    editedBy: obj.editedBy || null,
    updatedAt: obj.updatedAt,
    createdAt: obj.createdAt
  };
}

async function getNextOrder(category = 'general') {
  const last = await FaqItem.findOne({ category }).sort({ order: -1 }).select('order').lean();
  return ((last?.order || 0) + 10);
}

async function updateFaq(req, res) {
  try {
    const { id } = req.params;
    const updates = { ...req.body };

    // Si cambia el markdown, regenerar HTML sanitizado
    if (updates.answerMarkdown) {
      updates.answerHtml = {
        es: renderMarkdownSafe(updates.answerMarkdown?.es || ''),
        en: renderMarkdownSafe(updates.answerMarkdown?.en || '')
      };
    }
    updates.editedBy = req.user?._id || null;

    const doc = await FaqItem.findByIdAndUpdate(id, updates, { new: true });
    if (!doc) return res.status(404).json({ success: false, message: 'FAQ not found' });

    await invalidateFaqCache();
    return res.json({ success: true, data: serializeFaq(doc) });
  } catch (error) {
    console.error('CmsController - updateFaq error:', error);
    return res.status(500).json({ success: false, message: 'Failed to update FAQ' });
  }
}

async function deleteFaq(req, res) {
  try {
    const { id } = req.params;
    const doc = await FaqItem.findByIdAndDelete(id);
    if (!doc) return res.status(404).json({ success: false, message: 'FAQ not found' });
    await invalidateFaqCache();
    return res.json({ success: true, data: { id } });
  } catch (error) {
    console.error('CmsController - deleteFaq error:', error);
    return res.status(500).json({ success: false, message: 'Failed to delete FAQ' });
  }
}

async function reorderFaq(req, res) {
  try {
    const { order } = req.body;
    const ops = order.map((entry) => ({
      updateOne: {
        filter: { _id: entry.id },
        update: { $set: { order: entry.order } }
      }
    }));
    if (ops.length) await FaqItem.bulkWrite(ops);
    await invalidateFaqCache();
    return res.json({ success: true, data: { updated: ops.length } });
  } catch (error) {
    console.error('CmsController - reorderFaq error:', error);
    return res.status(500).json({ success: false, message: 'Failed to reorder FAQ' });
  }
}

// ─── Reset desde plantilla por defecto ──────────────────────────────────────

/**
 * POST /api/admin/cms/contents/:key/reset-from-defaults
 *
 * Re-importa la estructura completa de secciones por defecto (definida en
 * `cmsDefaults.js`) para la `key` indicada. Pensado para casos donde:
 *   - El admin entró al editor y vio sólo 1 sección placeholder (porque el
 *     seed inicial era mínimo) y al publicar perdió de vista el resto.
 *   - Quiere descartar todo lo editado y volver al texto original del sitio.
 *
 * Body opcional: { locale: 'es' | 'en' | 'both' (default 'both') }
 *
 * Conserva historial antes de sobreescribir (es no destructivo).
 */
async function resetContentFromDefaults(req, res) {
  try {
    const { key } = req.params;
    const localeArg = req.body?.locale || 'both';
    const defaults = buildDefaultTranslations(key);
    if (!defaults?.es?.sections?.length && !defaults?.en?.sections?.length) {
      return res.status(400).json({
        success: false,
        message: `No defaults available for key "${key}"`
      });
    }

    let doc = await CmsContent.findOne({ key });
    const now = new Date();
    if (!doc) {
      doc = new CmsContent({
        key,
        translations: { es: { title: '', sections: [] }, en: { title: '', sections: [] } },
        version: 0
      });
    }

    const localesToReset = localeArg === 'both' ? ['es', 'en'] : [localeArg];
    for (const loc of localesToReset) {
      // Snapshot del estado actual antes de sobreescribir (rollback friendly)
      const previous = doc.translations?.[loc];
      if (previous && (previous.title || (previous.sections && previous.sections.length))) {
        doc.pushHistory({
          version: doc.version,
          locale: loc,
          titleSnapshot: previous.title,
          sectionsSnapshot: previous.sections,
          editedBy: doc.editedBy,
          editedAt: now
        });
      }
      doc.translations[loc] = {
        title: defaults[loc].title,
        sections: defaults[loc].sections,
        lastEditedAt: now
      };
    }
    doc.version = (doc.version || 0) + 1;
    doc.publishedAt = now;
    doc.editedBy = req.user?._id || null;

    await doc.save();
    await invalidateContentCache(key);

    return res.json({
      success: true,
      data: {
        key,
        version: doc.version,
        publishedAt: doc.publishedAt,
        resetLocales: localesToReset,
        sectionsCount: {
          es: doc.translations.es.sections.length,
          en: doc.translations.en.sections.length
        }
      }
    });
  } catch (error) {
    console.error('CmsController - resetContentFromDefaults error:', error);
    return res.status(500).json({ success: false, message: 'Failed to reset content' });
  }
}

// ─── Service Category Overrides ─────────────────────────────────────────────
//
// Permiten al admin renombrar la etiqueta visible y la descripción corta de las
// 22 categorías de servicio sin tocar la clave canónica (que está acoplada a
// perfiles, solicitudes, matching y URLs SEO).

/**
 * GET /api/content/service-categories?locale=es
 * Público. Devuelve la lista combinada (clave + override aplicado o vacío).
 * El frontend usa esto al boot para mergear en i18n.
 */
async function getPublicServiceCategories(req, res) {
  try {
    const locale = ['es', 'en'].includes(req.query.locale) ? req.query.locale : 'es';
    const cached = await getCachedServiceCategories(locale);
    if (cached) {
      res.set('Cache-Control', CACHE_HEADERS.publicShortLive);
      return res.json({ success: true, data: cached });
    }
    const docs = await ServiceCategoryOverride.find({}).lean();
    const byKey = new Map(docs.map((d) => [d.canonicalKey, d]));
    // Sólo devolvemos overrides con texto válido en el locale pedido para no
    // contaminar el i18n con strings vacíos.
    const overrides = {};
    for (const key of SERVICE_CATEGORIES) {
      const o = byKey.get(key);
      if (!o) continue;
      const label = o.label?.[locale];
      const description = o.description?.[locale];
      if ((label && label.trim()) || (description && description.trim())) {
        overrides[key] = {
          ...(label && label.trim() ? { label } : {}),
          ...(description && description.trim() ? { description } : {})
        };
      }
    }
    const payload = { locale, overrides, count: Object.keys(overrides).length };
    await setCachedServiceCategories(locale, payload);
    res.set('Cache-Control', CACHE_HEADERS.publicShortLive);
    return res.json({ success: true, data: payload });
  } catch (error) {
    console.error('CmsController - getPublicServiceCategories error:', error);
    return res.status(500).json({ success: false, message: 'Failed to load service categories' });
  }
}

/**
 * GET /api/admin/cms/service-categories
 * Admin. Devuelve las 22 categorías canónicas con su override (o null).
 */
async function listServiceCategoriesAdmin(_req, res) {
  try {
    const docs = await ServiceCategoryOverride.find({}).lean();
    const byKey = new Map(docs.map((d) => [d.canonicalKey, d]));
    const items = SERVICE_CATEGORIES.map((key) => {
      const o = byKey.get(key);
      return {
        canonicalKey: key,
        hasOverride: Boolean(o),
        label: { es: o?.label?.es || '', en: o?.label?.en || '' },
        description: { es: o?.description?.es || '', en: o?.description?.en || '' },
        updatedAt: o?.updatedAt || null
      };
    });
    return res.json({ success: true, data: { items, total: items.length } });
  } catch (error) {
    console.error('CmsController - listServiceCategoriesAdmin error:', error);
    return res.status(500).json({ success: false, message: 'Failed to list service categories' });
  }
}

/**
 * PUT /api/admin/cms/service-categories/:key
 * Upsert. Acepta { label: { es, en }, description: { es, en } } (cualquier subset).
 */
async function upsertServiceCategoryOverride(req, res) {
  try {
    const { key } = req.params;
    if (!SERVICE_CATEGORIES.includes(key)) {
      return res.status(404).json({ success: false, message: 'Unknown service category' });
    }
    const { label = {}, description = {} } = req.body || {};
    const update = {
      $set: {
        canonicalKey: key,
        'label.es': String(label.es || '').trim().slice(0, 200),
        'label.en': String(label.en || '').trim().slice(0, 200),
        'description.es': String(description.es || '').trim().slice(0, 200),
        'description.en': String(description.en || '').trim().slice(0, 200),
        editedBy: req.user?._id || null
      }
    };
    const doc = await ServiceCategoryOverride.findOneAndUpdate(
      { canonicalKey: key },
      update,
      { upsert: true, new: true, setDefaultsOnInsert: true }
    );
    await invalidateServiceCategoriesCache();
    return res.json({ success: true, data: { canonicalKey: doc.canonicalKey, label: doc.label, description: doc.description, updatedAt: doc.updatedAt } });
  } catch (error) {
    console.error('CmsController - upsertServiceCategoryOverride error:', error);
    return res.status(500).json({ success: false, message: 'Failed to update service category' });
  }
}

/**
 * DELETE /api/admin/cms/service-categories/:key
 * Borra el override (la categoría vuelve a leer su texto del i18n).
 */
async function deleteServiceCategoryOverride(req, res) {
  try {
    const { key } = req.params;
    if (!SERVICE_CATEGORIES.includes(key)) {
      return res.status(404).json({ success: false, message: 'Unknown service category' });
    }
    await ServiceCategoryOverride.findOneAndDelete({ canonicalKey: key });
    await invalidateServiceCategoriesCache();
    return res.json({ success: true, data: { canonicalKey: key, removed: true } });
  } catch (error) {
    console.error('CmsController - deleteServiceCategoryOverride error:', error);
    return res.status(500).json({ success: false, message: 'Failed to delete service category override' });
  }
}

export default {
  // Públicos
  getPublicContent,
  getPublicFaq,
  getPublicServiceCategories,
  // Admin: contenidos
  listContents,
  getContentForAdmin,
  getHistoryEntry,
  updateContent,
  rollbackContent,
  resetContentFromDefaults,
  // Admin: FAQ
  listFaqAdmin,
  createFaq,
  updateFaq,
  deleteFaq,
  reorderFaq,
  // Admin: service categories
  listServiceCategoriesAdmin,
  upsertServiceCategoryOverride,
  deleteServiceCategoryOverride
};
