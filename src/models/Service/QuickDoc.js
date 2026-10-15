// models/Service/QuickDoc.js
//
// Flujo 2 — "Vía Rápida en Vivo".
// Documento directo (Estimado o Factura) creado libremente por un profesional,
// SIN ServiceRequest ni Booking previos. Se comparte con el cliente mediante un
// link/QR público protegido por token. Aislado del Flujo 1 (Proposal/Booking)
// para no afectar su lógica.
import mongoose from 'mongoose';
import crypto from 'crypto';

const quickDocSchema = new mongoose.Schema({
  // Tipo de documento: estimado o factura
  type: {
    type: String,
    enum: ['estimate', 'invoice'],
    required: true
  },

  // Profesional que crea el documento
  provider: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'Provider',
    required: true,
    index: true
  },

  // Estado del documento.
  //  - estimate: draft → sent → viewed → accepted | rejected | expired | cancelled | converted
  //  - invoice:  draft → sent → viewed → cancelled
  status: {
    type: String,
    enum: ['draft', 'sent', 'viewed', 'accepted', 'rejected', 'expired', 'cancelled', 'converted'],
    default: 'draft',
    index: true
  },

  // ---- Token público para el link/QR ----
  // Solo se almacena el hash SHA-256. El token en claro viaja en el link/QR y no
  // se persiste (mismo patrón que PasswordResetToken). No contiene PII.
  tokenHash: {
    type: String,
    required: true,
    index: true,
    unique: true
  },
  // Token en claro para que el PROFESIONAL (dueño) pueda volver a mostrar el
  // link/QR en cualquier momento. Es una capacidad de solo-lectura/compartir de
  // bajo riesgo y jamás se expone en la vista pública del cliente.
  publicToken: {
    type: String,
    default: null,
    select: false
  },
  // Expiración lógica del link (NO es TTL de Mongo: el documento debe persistir).
  tokenExpiresAt: {
    type: Date,
    required: true,
    index: true
  },

  // ---- Datos del cliente invitado ----
  clientEmail: {
    type: String,
    lowercase: true,
    trim: true,
    default: null,
    index: true
  },
  // Cuenta creada en segundo plano al capturar el correo (Flujo 2).
  clientAccount: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User',
    default: null
  },
  // Aceptación del aviso legal / términos de servicio al abrir el documento.
  termsAcceptedAt: {
    type: Date,
    default: null
  },
  clientInfo: {
    name: String,
    address: String,
    city: String,
    state: String,
    zip: String,
    phone: String
  },

  // ---- Datos del negocio (snapshot del profesional) ----
  businessInfo: {
    name: String,
    address: String,
    phone: String,
    email: String
  },

  // ---- Datos financieros (estimado o factura) ----
  documentNumber: {
    type: String,
    default: null
  },
  financials: {
    items: [{
      description: String,
      qty: Number,
      unitPrice: Number,
      total: Number
    }],
    subtotal: Number,
    discount: Number,
    taxRate: Number,
    tax: Number,
    shipping: Number,
    total: Number,
    currency: {
      type: String,
      default: 'USD'
    },
    // Rango de precio (solo estimados, cuando no hay monto exacto)
    isRange: {
      type: Boolean,
      default: false
    },
    amountMin: {
      type: Number,
      min: 0
    },
    amountMax: {
      type: Number,
      min: 0
    }
  },

  // Fechas del documento
  issueDate: {
    type: Date,
    default: Date.now
  },
  dueDate: Date,      // factura
  validUntil: Date,   // estimado

  notes: String,

  // Mensaje opcional del profesional, con traducciones es/en
  message: {
    type: String,
    default: ''
  },
  translations: {
    es: { message: String },
    en: { message: String }
  },

  // PDF alojado en Cloudinary (generado en el frontend, igual que el Flujo 1)
  pdfUrl: {
    type: String,
    default: null
  },

  // ---- Seguimiento de apertura ----
  viewCount: {
    type: Number,
    default: 0
  },
  firstViewedAt: {
    type: Date,
    default: null
  },
  lastViewedAt: {
    type: Date,
    default: null
  },

  // ---- Aceptación / conversión (solo estimados) ----
  acceptedAt: {
    type: Date,
    default: null
  },
  rejectedAt: {
    type: Date,
    default: null
  },
  // Factura resultante tras "Convertir a Invoice"
  convertedInvoice: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'QuickDoc',
    default: null
  },
  // Estimado de origen (cuando este documento es la factura resultante)
  sourceEstimate: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'QuickDoc',
    default: null
  },

  // Metadatos opcionales de auditoría
  metadata: {
    createdFromIp: String,
    userAgent: String
  }
}, {
  timestamps: true
});

// Índices de consulta frecuentes
quickDocSchema.index({ provider: 1, createdAt: -1 });
quickDocSchema.index({ provider: 1, type: 1, status: 1 });

/**
 * Genera un token público aleatorio y su hash SHA-256.
 * El token en claro se entrega una sola vez (link/QR); solo se persiste el hash.
 * @returns {{ token: string, tokenHash: string }}
 */
quickDocSchema.statics.generatePublicToken = function generatePublicToken() {
  const token = crypto.randomBytes(32).toString('hex');
  const tokenHash = crypto.createHash('sha256').update(token).digest('hex');
  return { token, tokenHash };
};

/**
 * Calcula el hash SHA-256 de un token recibido (para buscar por tokenHash).
 * @param {string} token
 * @returns {string}
 */
quickDocSchema.statics.hashToken = function hashToken(token) {
  return crypto.createHash('sha256').update(String(token)).digest('hex');
};

/**
 * Indica si el link del documento sigue vigente (no expirado, no cancelado).
 * @returns {boolean}
 */
quickDocSchema.methods.isLinkActive = function isLinkActive() {
  if (this.status === 'cancelled') return false;
  if (!this.tokenExpiresAt) return false;
  return this.tokenExpiresAt.getTime() > Date.now();
};

const QuickDoc = mongoose.model('QuickDoc', quickDocSchema);
export default QuickDoc;
