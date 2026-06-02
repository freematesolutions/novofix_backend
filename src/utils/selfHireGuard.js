// server/src/utils/selfHireGuard.js
//
// Helpers para prevenir el auto-contrato en usuarios multirol (Cliente/Profesional).
// Cuando un mismo usuario tiene los roles "client" y "provider", debemos impedir
// que se envíe propuestas a sí mismo, inicie chats consigo mismo o se incluya como
// proveedor objetivo de sus propias solicitudes.
//
// Uso típico en un controller Express:
//
//   import { isSameUser, buildSelfHireError } from '../utils/selfHireGuard.js';
//   if (isSameUser(req.user?._id, targetProviderId)) {
//     const err = buildSelfHireError('contact');
//     return res.status(err.status).json({ success: false, code: err.code, message: err.message });
//   }
//

/**
 * Convierte un valor (ObjectId, string, objeto poblado) en un string normalizado.
 * Devuelve null si el valor no es resolvible.
 * @param {*} value
 * @returns {string|null}
 */
export function toIdString(value) {
  if (!value) return null;
  if (typeof value === 'string') return value.trim() || null;
  if (typeof value === 'object') {
    if (value._id) return String(value._id);
    if (value.id) return String(value.id);
    if (typeof value.toString === 'function') {
      const s = value.toString();
      // Mongoose ObjectId.toString() === '[object Object]' would be a bug, ignore it
      if (s && s !== '[object Object]') return s;
    }
  }
  return null;
}

/**
 * Determina si dos referencias apuntan al mismo usuario.
 * Acepta cualquier combinación de string / ObjectId / documento poblado.
 * @param {*} a
 * @param {*} b
 * @returns {boolean}
 */
export function isSameUser(a, b) {
  const idA = toIdString(a);
  const idB = toIdString(b);
  if (!idA || !idB) return false;
  return idA === idB;
}

/**
 * Filtra una lista de proveedores objetivo eliminando al propio usuario.
 * Devuelve siempre un array nuevo de strings (ids normalizados).
 * @param {Array<*>} list
 * @param {*} currentUserId
 * @returns {string[]}
 */
export function filterOutSelf(list, currentUserId) {
  if (!Array.isArray(list)) return [];
  const selfId = toIdString(currentUserId);
  return list
    .map(toIdString)
    .filter((id) => id && id !== selfId);
}

/**
 * Construye un objeto de error estandarizado para devolver al cliente cuando
 * se detecta un intento de auto-contrato.
 *
 * @param {('contact'|'inquiry'|'proposal'|'request'|'chat')} scope
 *   Contexto en el que se detectó el auto-contrato. Define el mensaje devuelto.
 * @returns {{ status: number, code: string, message: string }}
 */
export function buildSelfHireError(scope = 'contact') {
  const map = {
    contact: 'You cannot contact yourself as a professional.',
    inquiry: 'You cannot start an inquiry with yourself.',
    proposal: 'You cannot send a proposal to your own service request.',
    request: 'You cannot include yourself as a target provider.',
    chat: 'You cannot open a chat with yourself.',
  };
  return {
    status: 400,
    code: 'SELF_HIRE_NOT_ALLOWED',
    message: map[scope] || map.contact,
  };
}

/**
 * Atajo que asegura que el actor (req.user) y el destinatario no sean el mismo usuario.
 * Si lo son, responde 400 con código SELF_HIRE_NOT_ALLOWED y devuelve true para que
 * el caller pueda hacer un `return` inmediato.
 *
 * @param {import('express').Response} res
 * @param {*} actorId
 * @param {*} targetId
 * @param {('contact'|'inquiry'|'proposal'|'request'|'chat')} [scope]
 * @returns {boolean} true si se respondió con error (caller debe abortar)
 */
export function rejectIfSelfHire(res, actorId, targetId, scope = 'contact') {
  if (!isSameUser(actorId, targetId)) return false;
  const err = buildSelfHireError(scope);
  res.status(err.status).json({
    success: false,
    code: err.code,
    message: err.message,
  });
  return true;
}

export default {
  toIdString,
  isSameUser,
  filterOutSelf,
  buildSelfHireError,
  rejectIfSelfHire,
};
