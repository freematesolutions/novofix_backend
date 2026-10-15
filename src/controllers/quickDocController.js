// controllers/quickDocController.js
//
// Flujo 2 — "Vía Rápida en Vivo" (QuickDoc).
// Creación libre de Estimado/Factura por el profesional + acceso público por
// token (link/QR), captura de correo con cuenta en segundo plano, aceptación de
// estimado, conversión a factura y proxy de PDF. Aislado del Flujo 1.
import QuickDoc from '../models/Service/QuickDoc.js';
import Provider from '../models/User/Provider.js';
import notificationService from '../services/external/notificationService.js';
import { createOrLinkBackgroundClient } from '../services/internal/quickDocService.js';
import cloudinary from '../config/cloudinary.js';

const getFrontendBaseUrl = () =>
  (process.env.FRONTEND_URL || 'http://localhost:5173').replace(/\/+$/, '');

/** Construye la URL pública del documento a partir del token en claro. */
const buildPublicUrl = (token) => `${getFrontendBaseUrl()}/d/${token}`;

/** Normaliza el bloque financiero recibido desde el frontend. */
function normalizeFinancials(f = {}) {
  return {
    items: Array.isArray(f.items) ? f.items.map((it) => ({
      description: it.description || '',
      qty: Number(it.qty) || 0,
      unitPrice: Number(it.unitPrice) || 0,
      total: Number(it.total) || 0
    })) : [],
    subtotal: Number(f.subtotal) || 0,
    discount: Number(f.discount) || 0,
    taxRate: Number(f.taxRate) || 0,
    tax: Number(f.tax) || 0,
    shipping: Number(f.shipping) || 0,
    total: Number(f.total) || 0,
    currency: f.currency || 'USD',
    isRange: !!f.isRange,
    amountMin: f.amountMin != null ? Number(f.amountMin) : undefined,
    amountMax: f.amountMax != null ? Number(f.amountMax) : undefined
  };
}

/** Snapshot del negocio a partir del perfil del proveedor (fallbacks seguros). */
function buildBusinessSnapshot(provider, override = {}) {
  const pp = provider?.providerProfile || {};
  const profile = provider?.profile || {};
  const fullName = `${profile.firstName || ''} ${profile.lastName || ''}`.trim();
  return {
    name: override.name || pp.businessName || fullName || 'Profesional',
    address: override.address || pp.serviceArea?.zones?.[0] || '',
    phone: override.phone || profile.phone || '',
    email: override.email || provider?.email || ''
  };
}

/** Vista pública segura del documento (sin PII sensible ni hashes). */
function toPublicView(doc) {
  return {
    id: doc._id,
    type: doc.type,
    status: doc.status,
    documentNumber: doc.documentNumber,
    businessInfo: doc.businessInfo,
    clientInfo: doc.clientInfo,
    financials: doc.financials,
    issueDate: doc.issueDate,
    dueDate: doc.dueDate,
    validUntil: doc.validUntil,
    notes: doc.notes,
    message: doc.message,
    translations: doc.translations,
    pdfUrl: doc.pdfUrl,
    hasClaimed: !!doc.clientAccount,
    acceptedAt: doc.acceptedAt,
    convertedInvoice: doc.convertedInvoice,
    createdAt: doc.createdAt
  };
}

/** Nombre legible del profesional para notificaciones. */
function providerDisplayName(provider) {
  const pp = provider?.providerProfile || {};
  const profile = provider?.profile || {};
  return pp.businessName
    || `${profile.firstName || ''} ${profile.lastName || ''}`.trim()
    || 'Profesional';
}

/**
 * Sirve el PDF de un QuickDoc desde Cloudinary usando una URL autenticada
 * (Cloudinary deshabilita la entrega directa de PDF/raw por defecto).
 * Misma técnica que bookingController.getInvoicePdf.
 */
async function streamQuickDocPdf(res, doc) {
  const pdfUrl = doc.pdfUrl;
  if (!pdfUrl) {
    return res.status(404).json({ success: false, message: 'No PDF available' });
  }

  let fetchUrl = pdfUrl;
  try {
    const parsed = new URL(pdfUrl);
    if (parsed.hostname.includes('cloudinary')) {
      const pathParts = parsed.pathname.split('/').filter(Boolean);
      const resourceType = pathParts[1] || 'raw';
      let publicIdStart = 3;
      if (pathParts[3] && /^v\d+$/.test(pathParts[3])) publicIdStart = 4;
      const publicId = pathParts.slice(publicIdStart).join('/');
      fetchUrl = cloudinary.utils.private_download_url(publicId, '', {
        resource_type: resourceType,
        type: 'upload',
        expires_at: Math.floor(Date.now() / 1000) + 3600
      });
    }
  } catch (urlErr) {
    console.warn('QuickDocController - streamQuickDocPdf: URL build failed, using original:', urlErr.message);
  }

  let response = await fetch(fetchUrl);
  if (!response.ok && fetchUrl !== pdfUrl) {
    response = await fetch(pdfUrl);
  }
  if (!response.ok) {
    return res.status(502).json({ success: false, message: 'Failed to fetch PDF from storage' });
  }

  const contentType = response.headers.get('content-type') || 'application/pdf';
  const label = doc.type === 'invoice' ? 'Invoice' : 'Estimate';
  const fileName = `${label}_${doc.documentNumber || doc._id}.pdf`;

  res.setHeader('Content-Type', contentType);
  res.setHeader('Content-Disposition', `inline; filename="${fileName}"`);
  res.setHeader('Cache-Control', 'private, max-age=3600');

  const arrayBuffer = await response.arrayBuffer();
  return res.send(Buffer.from(arrayBuffer));
}

class QuickDocController {
  // ───────────────────────── PROFESIONAL (protegido) ─────────────────────────

  /**
   * Crear un Estimado o Factura libre (sin ServiceRequest/Booking).
   * POST /provider/quick-docs
   */
  async createQuickDoc(req, res) {
    try {
      const provider = await Provider.findById(req.user._id)
        .select('providerProfile profile email');
      if (!provider) {
        return res.status(404).json({ success: false, message: 'Provider not found' });
      }

      const {
        type, documentNumber, clientInfo, businessInfo, financials,
        issueDate, dueDate, validUntil, notes, message, pdfUrl, expiresInDays
      } = req.body;

      const { token, tokenHash } = QuickDoc.generatePublicToken();
      const days = Number(expiresInDays) || 30;
      const tokenExpiresAt = new Date(Date.now() + days * 24 * 60 * 60 * 1000);

      const doc = new QuickDoc({
        type,
        provider: provider._id,
        status: 'sent', // creado y listo para compartir
        tokenHash,
        publicToken: token,
        tokenExpiresAt,
        documentNumber: documentNumber || null,
        clientInfo: clientInfo || {},
        businessInfo: buildBusinessSnapshot(provider, businessInfo || {}),
        financials: normalizeFinancials(financials),
        issueDate: issueDate ? new Date(issueDate) : new Date(),
        dueDate: dueDate ? new Date(dueDate) : null,
        validUntil: validUntil ? new Date(validUntil) : null,
        notes: notes || '',
        message: message || '',
        pdfUrl: pdfUrl || null,
        metadata: {
          createdFromIp: req.ip,
          userAgent: req.headers['user-agent']
        }
      });

      await doc.save();

      return res.status(201).json({
        success: true,
        message: 'Quick document created',
        data: {
          doc: toPublicView(doc),
          publicUrl: buildPublicUrl(token),
          token, // el token en claro solo se devuelve aquí (para link/QR)
          expiresAt: tokenExpiresAt
        }
      });
    } catch (error) {
      console.error('QuickDocController - createQuickDoc error:', error);
      return res.status(500).json({ success: false, message: 'Failed to create quick document' });
    }
  }

  /**
   * Listar los documentos rápidos del profesional.
   * GET /provider/quick-docs
   */
  async listQuickDocs(req, res) {
    try {
      const { type, status, page = 1, limit = 20 } = req.query;
      const filter = { provider: req.user._id };
      if (type) filter.type = type;
      if (status) filter.status = status;

      const pageNum = Math.max(1, parseInt(page, 10) || 1);
      const limitNum = Math.min(50, Math.max(1, parseInt(limit, 10) || 20));

      const [docs, total] = await Promise.all([
        QuickDoc.find(filter)
          .sort({ createdAt: -1 })
          .skip((pageNum - 1) * limitNum)
          .limit(limitNum)
          .lean(),
        QuickDoc.countDocuments(filter)
      ]);

      return res.json({
        success: true,
        data: {
          docs: docs.map((d) => ({
            id: d._id,
            type: d.type,
            status: d.status,
            documentNumber: d.documentNumber,
            clientEmail: d.clientEmail,
            clientName: d.clientInfo?.name || null,
            total: d.financials?.total,
            currency: d.financials?.currency || 'USD',
            viewCount: d.viewCount,
            firstViewedAt: d.firstViewedAt,
            acceptedAt: d.acceptedAt,
            tokenExpiresAt: d.tokenExpiresAt,
            createdAt: d.createdAt
          })),
          pagination: { page: pageNum, limit: limitNum, total }
        }
      });
    } catch (error) {
      console.error('QuickDocController - listQuickDocs error:', error);
      return res.status(500).json({ success: false, message: 'Failed to list quick documents' });
    }
  }

  /**
   * Detalle de un documento rápido del profesional (incluye estado de apertura).
   * GET /provider/quick-docs/:id
   */
  async getQuickDoc(req, res) {
    try {
      const doc = await QuickDoc.findOne({ _id: req.params.id, provider: req.user._id })
        .select('+publicToken');
      if (!doc) {
        return res.status(404).json({ success: false, message: 'Quick document not found' });
      }
      // El link/QR solo sigue siendo válido si el documento está activo.
      const shareable = doc.isLinkActive() && !!doc.publicToken;
      return res.json({
        success: true,
        data: {
          doc: {
            ...toPublicView(doc),
            clientEmail: doc.clientEmail,
            viewCount: doc.viewCount,
            firstViewedAt: doc.firstViewedAt,
            lastViewedAt: doc.lastViewedAt,
            tokenExpiresAt: doc.tokenExpiresAt
          },
          publicUrl: shareable ? buildPublicUrl(doc.publicToken) : null
        }
      });
    } catch (error) {
      console.error('QuickDocController - getQuickDoc error:', error);
      return res.status(500).json({ success: false, message: 'Failed to load quick document' });
    }
  }

  /**
   * Proxy del PDF para el PROFESIONAL dueño (descarga desde el panel).
   * GET /provider/quick-docs/:id/pdf
   */
  async getProviderQuickDocPdf(req, res) {
    try {
      const doc = await QuickDoc.findOne({ _id: req.params.id, provider: req.user._id })
        .select('pdfUrl type documentNumber');
      if (!doc) {
        return res.status(404).json({ success: false, message: 'Quick document not found' });
      }
      return await streamQuickDocPdf(res, doc);
    } catch (error) {
      console.error('QuickDocController - getProviderQuickDocPdf error:', error);
      return res.status(500).json({ success: false, message: 'Failed to proxy PDF' });
    }
  }

  /**
   * (Re)generar el enlace público para compartir. Útil para documentos creados
   * antes de persistir el token o cuando el profesional quiere un enlace nuevo.
   * Extiende además la vigencia del enlace. No aplica a documentos cancelados/convertidos.
   * POST /provider/quick-docs/:id/share-link
   */
  async regenerateShareLink(req, res) {
    try {
      const doc = await QuickDoc.findOne({ _id: req.params.id, provider: req.user._id })
        .select('+publicToken');
      if (!doc) {
        return res.status(404).json({ success: false, message: 'Quick document not found' });
      }
      if (['cancelled', 'converted'].includes(doc.status)) {
        return res.status(400).json({
          success: false,
          message: 'Cannot generate a link for a cancelled or converted document'
        });
      }

      const { token, tokenHash } = QuickDoc.generatePublicToken();
      const days = Number(req.body?.expiresInDays) || 30;
      doc.tokenHash = tokenHash;
      doc.publicToken = token;
      doc.tokenExpiresAt = new Date(Date.now() + days * 24 * 60 * 60 * 1000);
      await doc.save();

      return res.json({
        success: true,
        message: 'Share link generated',
        data: {
          publicUrl: buildPublicUrl(token),
          expiresAt: doc.tokenExpiresAt
        }
      });
    } catch (error) {
      console.error('QuickDocController - regenerateShareLink error:', error);
      return res.status(500).json({ success: false, message: 'Failed to generate share link' });
    }
  }

  /**
   * Convertir un Estimado ACEPTADO en Factura.
   * POST /provider/quick-docs/:id/convert
   */
  async convertToInvoice(req, res) {
    try {
      const provider = await Provider.findById(req.user._id)
        .select('providerProfile profile email');
      const estimate = await QuickDoc.findOne({
        _id: req.params.id,
        provider: req.user._id,
        type: 'estimate'
      });

      if (!estimate) {
        return res.status(404).json({ success: false, message: 'Estimate not found' });
      }
      if (estimate.status !== 'accepted') {
        return res.status(400).json({
          success: false,
          message: 'Only accepted estimates can be converted to an invoice'
        });
      }
      if (estimate.convertedInvoice) {
        return res.status(400).json({ success: false, message: 'Estimate already converted' });
      }

      const {
        documentNumber, financials, dueDate, notes, message, pdfUrl, expiresInDays
      } = req.body || {};

      const { token, tokenHash } = QuickDoc.generatePublicToken();
      const days = Number(expiresInDays) || 30;
      const tokenExpiresAt = new Date(Date.now() + days * 24 * 60 * 60 * 1000);

      const invoice = new QuickDoc({
        type: 'invoice',
        provider: provider._id,
        status: 'sent',
        tokenHash,
        publicToken: token,
        tokenExpiresAt,
        documentNumber: documentNumber || estimate.documentNumber || null,
        clientEmail: estimate.clientEmail,
        clientAccount: estimate.clientAccount,
        clientInfo: estimate.clientInfo,
        businessInfo: buildBusinessSnapshot(provider, {}),
        financials: financials ? normalizeFinancials(financials) : estimate.financials,
        issueDate: new Date(),
        dueDate: dueDate ? new Date(dueDate) : null,
        notes: notes != null ? notes : estimate.notes,
        message: message != null ? message : estimate.message,
        pdfUrl: pdfUrl || null,
        sourceEstimate: estimate._id
      });
      await invoice.save();

      estimate.status = 'converted';
      estimate.convertedInvoice = invoice._id;
      await estimate.save();

      return res.status(201).json({
        success: true,
        message: 'Estimate converted to invoice',
        data: {
          doc: toPublicView(invoice),
          publicUrl: buildPublicUrl(token),
          token,
          expiresAt: tokenExpiresAt
        }
      });
    } catch (error) {
      console.error('QuickDocController - convertToInvoice error:', error);
      return res.status(500).json({ success: false, message: 'Failed to convert estimate' });
    }
  }

  /**
   * Cancelar un documento rápido (invalida el link).
   * POST /provider/quick-docs/:id/cancel
   */
  async cancelQuickDoc(req, res) {
    try {
      const doc = await QuickDoc.findOne({ _id: req.params.id, provider: req.user._id });
      if (!doc) {
        return res.status(404).json({ success: false, message: 'Quick document not found' });
      }
      if (['accepted', 'converted'].includes(doc.status)) {
        return res.status(400).json({
          success: false,
          message: 'Cannot cancel a document that was accepted or converted'
        });
      }
      doc.status = 'cancelled';
      await doc.save();
      return res.json({ success: true, message: 'Quick document cancelled' });
    } catch (error) {
      console.error('QuickDocController - cancelQuickDoc error:', error);
      return res.status(500).json({ success: false, message: 'Failed to cancel quick document' });
    }
  }

  // ───────────────────────────── PÚBLICO (por token) ─────────────────────────

  /**
   * Ver documento por token público. Marca apertura y notifica al profesional
   * (una sola vez). Devuelve una vista segura sin datos sensibles.
   * GET /public/quick-docs/:token
   */
  async getPublicQuickDoc(req, res) {
    try {
      const tokenHash = QuickDoc.hashToken(req.params.token);
      const doc = await QuickDoc.findOne({ tokenHash });

      if (!doc) {
        return res.status(404).json({ success: false, message: 'Document not found' });
      }
      if (!doc.isLinkActive()) {
        return res.status(410).json({ success: false, message: 'This link has expired or was cancelled' });
      }

      // Seguimiento de apertura
      const isFirstView = !doc.firstViewedAt;
      doc.viewCount = (doc.viewCount || 0) + 1;
      doc.lastViewedAt = new Date();
      if (isFirstView) doc.firstViewedAt = doc.lastViewedAt;
      if (doc.status === 'sent') doc.status = 'viewed';
      await doc.save();

      // Notificar al profesional solo en la primera apertura
      if (isFirstView) {
        try {
          await notificationService.sendProviderNotification({
            providerId: doc.provider,
            type: 'QUICKDOC_VIEWED',
            priority: 'medium',
            data: {
              quickDocId: doc._id,
              docType: doc.type,
              documentNumber: doc.documentNumber || '',
              amount: doc.financials?.total || '',
              currency: doc.financials?.currency || 'USD'
            }
          });
        } catch (notifErr) {
          console.warn('QuickDocController - getPublicQuickDoc: notification failed', notifErr?.message);
        }
      }

      return res.json({ success: true, data: { doc: toPublicView(doc) } });
    } catch (error) {
      console.error('QuickDocController - getPublicQuickDoc error:', error);
      return res.status(500).json({ success: false, message: 'Failed to load document' });
    }
  }

  /**
   * Capturar correo + aceptación de términos → crea cuenta en segundo plano.
   * POST /public/quick-docs/:token/claim
   */
  async claimQuickDoc(req, res) {
    try {
      const { email, name, acceptTerms, locale } = req.body;
      const tokenHash = QuickDoc.hashToken(req.params.token);
      const doc = await QuickDoc.findOne({ tokenHash });

      if (!doc) {
        return res.status(404).json({ success: false, message: 'Document not found' });
      }
      if (!doc.isLinkActive()) {
        return res.status(410).json({ success: false, message: 'This link has expired or was cancelled' });
      }
      if (!acceptTerms) {
        return res.status(400).json({ success: false, message: 'Terms must be accepted' });
      }

      const { user } = await createOrLinkBackgroundClient({
        email,
        name,
        locale: locale || 'es',
        req
      });

      doc.clientEmail = String(email).toLowerCase().trim();
      doc.clientAccount = user._id;
      doc.termsAcceptedAt = new Date();
      if (name && !doc.clientInfo?.name) {
        doc.clientInfo = { ...(doc.clientInfo || {}), name };
      }
      await doc.save();

      return res.json({
        success: true,
        message: 'Email captured',
        data: { doc: toPublicView(doc) }
      });
    } catch (error) {
      console.error('QuickDocController - claimQuickDoc error:', error);
      return res.status(500).json({ success: false, message: 'Failed to process email' });
    }
  }

  /**
   * Aceptar un Estimado (habilita al profesional la conversión a Factura).
   * POST /public/quick-docs/:token/accept
   */
  async acceptPublicEstimate(req, res) {
    try {
      const tokenHash = QuickDoc.hashToken(req.params.token);
      const doc = await QuickDoc.findOne({ tokenHash });

      if (!doc) {
        return res.status(404).json({ success: false, message: 'Document not found' });
      }
      if (!doc.isLinkActive()) {
        return res.status(410).json({ success: false, message: 'This link has expired or was cancelled' });
      }
      if (doc.type !== 'estimate') {
        return res.status(400).json({ success: false, message: 'Only estimates can be accepted' });
      }
      if (!doc.clientAccount) {
        return res.status(400).json({ success: false, message: 'Please provide your email before accepting' });
      }
      if (doc.status === 'accepted') {
        return res.json({ success: true, message: 'Estimate already accepted', data: { doc: toPublicView(doc) } });
      }
      if (['rejected', 'cancelled', 'converted', 'expired'].includes(doc.status)) {
        return res.status(400).json({ success: false, message: 'This estimate can no longer be accepted' });
      }

      doc.status = 'accepted';
      doc.acceptedAt = new Date();
      await doc.save();

      // Notificar al profesional
      try {
        await notificationService.sendProviderNotification({
          providerId: doc.provider,
          type: 'QUICKDOC_ACCEPTED',
          priority: 'high',
          data: {
            quickDocId: doc._id,
            documentNumber: doc.documentNumber || '',
            amount: doc.financials?.total || '',
            currency: doc.financials?.currency || 'USD',
            clientName: doc.clientInfo?.name || doc.clientEmail || ''
          }
        });
      } catch (notifErr) {
        console.warn('QuickDocController - acceptPublicEstimate: notification failed', notifErr?.message);
      }

      return res.json({ success: true, message: 'Estimate accepted', data: { doc: toPublicView(doc) } });
    } catch (error) {
      console.error('QuickDocController - acceptPublicEstimate error:', error);
      return res.status(500).json({ success: false, message: 'Failed to accept estimate' });
    }
  }

  /**
   * Proxy del PDF por token (sirve el PDF desde Cloudinary con auth).
   * GET /public/quick-docs/:token/pdf
   */
  async getPublicQuickDocPdf(req, res) {
    try {
      const tokenHash = QuickDoc.hashToken(req.params.token);
      const doc = await QuickDoc.findOne({ tokenHash }).select('pdfUrl type documentNumber status tokenExpiresAt clientAccount');

      if (!doc) {
        return res.status(404).json({ success: false, message: 'Document not found' });
      }
      if (!doc.isLinkActive()) {
        return res.status(410).json({ success: false, message: 'This link has expired or was cancelled' });
      }
      // El cliente debe haber confirmado su correo (claim) antes de ver el PDF.
      if (!doc.clientAccount) {
        return res.status(403).json({ success: false, message: 'Email confirmation required before viewing the document' });
      }
      const pdfUrl = doc.pdfUrl;
      if (!pdfUrl) {
        return res.status(404).json({ success: false, message: 'No PDF available' });
      }

      return await streamQuickDocPdf(res, doc);
    } catch (error) {
      console.error('QuickDocController - getPublicQuickDocPdf error:', error);
      return res.status(500).json({ success: false, message: 'Failed to proxy PDF' });
    }
  }
}

export default new QuickDocController();
