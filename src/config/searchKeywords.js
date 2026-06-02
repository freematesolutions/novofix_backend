// config/searchKeywords.js
// Diccionario bilingüe centralizado de keywords para búsqueda inteligente
// Cada categoría tiene keywords en español e inglés, más sinónimos y frases contextuales
// Fácil de mantener y extender — solo agregar palabras al array correspondiente

import { SERVICE_CATEGORIES } from './categories.js';

/**
 * Normaliza texto: quita acentos/diacríticos, pasa a minúsculas
 * Permite matching cross-idioma: "plomería" === "plomeria"
 */
export function normalizeText(text) {
  if (!text) return '';
  return String(text)
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .trim();
}

/**
 * Distancia de Levenshtein simplificada — solo calcula hasta maxDist para performance
 * Retorna true si la distancia es <= maxDist
 */
export function isFuzzyMatch(a, b, maxDist = 2) {
  const na = normalizeText(a);
  const nb = normalizeText(b);
  if (na === nb) return true;
  if (Math.abs(na.length - nb.length) > maxDist) return false;
  
  // Para palabras cortas (<= 4 chars), solo permitir distancia 1
  const effectiveMax = Math.min(na.length, nb.length) <= 4 ? 1 : maxDist;
  
  // Algoritmo de distancia de Levenshtein optimizado con early exit
  const len1 = na.length;
  const len2 = nb.length;
  const matrix = [];
  
  for (let i = 0; i <= len1; i++) matrix[i] = [i];
  for (let j = 0; j <= len2; j++) matrix[0][j] = j;
  
  for (let i = 1; i <= len1; i++) {
    let rowMin = Infinity;
    for (let j = 1; j <= len2; j++) {
      const cost = na[i - 1] === nb[j - 1] ? 0 : 1;
      matrix[i][j] = Math.min(
        matrix[i - 1][j] + 1,
        matrix[i][j - 1] + 1,
        matrix[i - 1][j - 1] + cost
      );
      rowMin = Math.min(rowMin, matrix[i][j]);
    }
    // Early exit: si toda la fila excede maxDist, no puede mejorar
    if (rowMin > effectiveMax) return false;
  }
  
  return matrix[len1][len2] <= effectiveMax;
}

/**
 * Diccionario bilingüe de keywords por categoría (22 categorías)
 * Estructura: { category: { es: [...], en: [...] } }
 * Incluye: nombres directos, sinónimos, objetos relacionados, problemas comunes, frases contextuales
 */
export const SEARCH_KEYWORDS = {
  'Reparaciones': {
    es: [
      'handiman', 'handyman', 'todero', 'multiservicio', 'manitas',
      'reparaciones', 'arreglos', 'pequeñas reparaciones', 'trabajos menores',
      'montar', 'colgar', 'instalar', 'reparar', 'arreglar',
      'estante', 'estantes', 'repisa', 'cuadro', 'cuadros', 'cortina', 'cortinas',
      'persiana', 'persianas', 'puerta', 'ventana', 'bisagra', 'bisagras',
      'manija', 'pomo', 'tornillo', 'tornillos', 'clavo', 'clavos',
      'goteo', 'ajuste', 'ajustar', 'nivel', 'nivelar',
      // Frases contextuales
      'arreglos generales', 'reparaciones menores', 'trabajos casa',
      'colgar cuadro', 'montar mueble', 'instalar estante', 'ajustar puerta',
      'reparar bisagra', 'pequeño arreglo', 'necesito arreglar'
    ],
    en: [
      'handyman', 'handiman', 'jack of all trades', 'odd jobs', 'fix it',
      'repairs', 'minor repairs', 'small repairs', 'home repairs',
      'mount', 'hang', 'install', 'fix', 'repair', 'adjust',
      'shelf', 'shelves', 'picture', 'curtain', 'curtains',
      'blind', 'blinds', 'door', 'window', 'hinge', 'hinges',
      'handle', 'knob', 'screw', 'screws', 'nail', 'nails',
      'drip', 'dripping', 'level', 'leveling',
      // Contextual phrases
      'general repairs', 'minor fixes', 'home fixes',
      'hang picture', 'mount shelf', 'install shelf', 'fix door',
      'repair hinge', 'small fix', 'need fixing', 'odd job'
    ]
  },
  'Plomería': {
    es: [
      'plomero', 'plomeria', 'fontanero', 'fontaneria', 'agua', 'tuberia', 'tuberias', 'cano', 'canos',
      'fuga', 'fugas', 'filtracion', 'goteo', 'gotear', 'gotea', 'tapar', 'destapa', 'destapar', 'desatora', 'desatorar',
      'inodoro', 'bano', 'lavabo', 'grifo', 'grifos', 'ducha', 'regadera', 'caneria', 'canerias',
      'drenaje', 'desague', 'desagues', 'bomba agua', 'calentador', 'boiler', 'tinaco', 'cisterna',
      'valvula', 'llave agua', 'llave paso', 'sifon', 'mingitorio', 'tina',
      // Frases contextuales
      'problema agua', 'fuga agua', 'se sale agua', 'no sale agua', 'agua caliente',
      'instalacion agua', 'reparar tuberia', 'arreglar fuga', 'cambiar tuberia', 'instalar lavabo'
    ],
    en: [
      'plumber', 'plumbing', 'water', 'pipe', 'pipes', 'piping', 'leak', 'leaks', 'leaking', 'leaky',
      'faucet', 'faucets', 'drain', 'drains', 'drainage', 'clog', 'clogged', 'unclog',
      'toilet', 'bathroom', 'sink', 'shower', 'bathtub', 'tub', 'valve', 'valves',
      'water heater', 'boiler', 'sewer', 'sewage', 'sprinkler', 'irrigation',
      'garbage disposal', 'water tank', 'water pump', 'water pressure',
      // Contextual phrases
      'water problem', 'water leak', 'no hot water', 'fix pipe', 'broken pipe',
      'install sink', 'repair faucet', 'dripping water'
    ]
  },
  'Electricidad': {
    es: [
      'electricista', 'electricidad', 'electrico', 'luz', 'luces', 'cables', 'cable', 'cableado',
      'interruptor', 'interruptores', 'enchufe', 'enchufes', 'toma', 'tomas', 'tomacorriente',
      'corriente', 'instalacion electrica', 'apagon', 'cortocircuito', 'corto circuito',
      'breaker', 'fusible', 'fusibles', 'voltaje', 'conexion', 'conexiones', 'alumbrado',
      'lampara', 'lamparas', 'foco', 'focos', 'led', 'centro carga', 'tablero electrico',
      'tierra fisica', 'contacto', 'contactos', 'regulador', 'transformador',
      // Frases contextuales
      'no hay luz', 'sin luz', 'se fue la luz', 'no funciona luz', 'problema electrico',
      'cambiar enchufe', 'instalar lampara', 'arreglar luz', 'reparar instalacion', 'revisar instalacion'
    ],
    en: [
      'electrician', 'electricity', 'electrical', 'electric', 'light', 'lights', 'lighting',
      'wire', 'wires', 'wiring', 'cable', 'cables',
      'switch', 'switches', 'outlet', 'outlets', 'socket', 'sockets', 'plug', 'plugs',
      'circuit', 'breaker', 'fuse', 'fuses', 'panel', 'voltage',
      'lamp', 'bulb', 'led', 'chandelier', 'ceiling fan',
      'power outage', 'short circuit', 'grounding',
      // Contextual phrases
      'no power', 'no electricity', 'power went out', 'electrical problem',
      'install light', 'fix wiring', 'change outlet', 'repair switch'
    ]
  },
  'Limpieza': {
    es: [
      'limpieza', 'limpiar', 'limpiador', 'aseo', 'asear',
      'desinfeccion', 'desinfectar', 'sanitizar', 'sanitizacion',
      'aspirar', 'trapear', 'barrer', 'pulir', 'brillar', 'lavar',
      'detergente', 'domestico', 'domestica', 'mucama', 'empleada hogar',
      'lavanderia', 'planchar', 'planchado',
      // Frases contextuales
      'limpiar casa', 'limpiar oficina', 'limpiar departamento',
      'limpieza profunda', 'limpieza hogar', 'servicio limpieza',
      'personal limpieza', 'hacer limpieza', 'necesito limpieza',
      'limpieza post obra', 'limpieza mudanza'
    ],
    en: [
      'cleaning', 'clean', 'cleaner', 'housekeeper', 'housekeeping', 'maid',
      'janitor', 'janitorial', 'sanitation', 'sanitize', 'disinfect', 'disinfection',
      'vacuum', 'mop', 'sweep', 'polish', 'scrub', 'wash', 'dust', 'dusting',
      'laundry', 'ironing',
      // Contextual phrases
      'clean house', 'clean office', 'clean apartment',
      'deep cleaning', 'house cleaning', 'cleaning service',
      'spring cleaning', 'move out cleaning', 'post construction cleaning'
    ]
  },
  'Pintura': {
    es: [
      'pintor', 'pintura', 'pintar', 'pintado', 'pared', 'paredes', 'barniz', 'barnizar',
      'acabados', 'empaste', 'resane', 'resanar', 'color', 'colores',
      'esmalte', 'latex', 'brocha', 'rodillo', 'fachada', 'fachadas',
      'impermeabilizante', 'impermeabilizar', 'sellador', 'primer', 'base',
      'textura', 'texturas', 'estuco', 'veneciano', 'aerosol', 'spray',
      // Frases contextuales
      'pintar casa', 'pintar habitacion', 'pintar cuarto', 'pintar fachada',
      'pintar exterior', 'pintar interior', 'pintar departamento', 'pintar oficina',
      'necesito pintor', 'mancha pared', 'humedad pared', 'descascarado'
    ],
    en: [
      'painter', 'painting', 'paint', 'wall', 'walls', 'varnish', 'stain',
      'finish', 'finishing', 'spackle', 'patching', 'color', 'colors',
      'enamel', 'latex', 'brush', 'roller', 'facade', 'primer', 'sealer',
      'texture', 'stucco', 'spray', 'coat', 'coating',
      'waterproof', 'waterproofing',
      // Contextual phrases
      'paint house', 'paint room', 'paint apartment', 'paint office',
      'paint exterior', 'paint interior', 'need painter', 'wall stain',
      'peeling paint', 'wall damage'
    ]
  },
  'Refrigeración': {
    es: [
      'refrigeracion', 'refrigeración', 'refrigerador', 'refrigeradora', 'nevera', 'neveras',
      'congelador', 'congeladora', 'freezer', 'frigorifico', 'frigorífico', 'heladera',
      'cuarto frio', 'cuarto frío', 'camara frigorifica', 'cámara frigorífica', 'walk in cooler',
      'vitrina refrigerada', 'vitrina', 'enfriador', 'enfriadora', 'chiller',
      'compresor', 'gas refrigerante', 'recarga gas', 'fuga gas', 'evaporador', 'condensador',
      'no enfria', 'no enfría', 'no congela', 'no hace hielo', 'hace ruido', 'gotea agua', 'pierde frio', 'pierde frío',
      // Frases contextuales
      'reparar refrigerador', 'reparar nevera', 'reparar congelador',
      'mantenimiento refrigeracion', 'instalar refrigerador', 'cambiar compresor',
      'recarga gas refrigerante', 'refrigeracion comercial', 'refrigeracion industrial'
    ],
    en: [
      'refrigeration', 'refrigerator', 'fridge', 'freezer', 'icebox',
      'walk in cooler', 'walk-in cooler', 'walk-in freezer', 'cold room', 'cold storage',
      'display cooler', 'reach in cooler', 'reach-in cooler', 'chiller',
      'compressor', 'refrigerant', 'gas leak', 'evaporator', 'condenser',
      'not cooling', 'not freezing', 'no ice', 'making noise', 'leaking water', 'losing cold',
      // Contextual phrases
      'refrigerator repair', 'fridge repair', 'freezer repair',
      'refrigeration maintenance', 'install refrigerator', 'compressor replacement',
      'refrigerant recharge', 'commercial refrigeration', 'industrial refrigeration'
    ]
  },
  'Garaje': {
    es: [
      'garaje', 'garage', 'cochera', 'parking', 'estacionamiento',
      'puerta', 'porton', 'portón', 'puerta de garaje', 'puerta seccional',
      'motor', 'abrepuertas', 'control remoto', 'opener',
      'estanteria', 'estantería', 'estantes', 'organizar', 'organizacion', 'organización',
      'piso', 'epoxico', 'epóxico', 'epoxi', 'iluminacion', 'iluminación', 'ventilacion', 'ventilación',
      'reparar puerta', 'instalar puerta', 'cambiar motor', 'mantener garaje',
      // Frases contextuales
      'puerta de garaje', 'motor de garaje', 'control de garaje',
      'organizar garaje', 'estanterias garaje', 'piso de garaje',
      'reparacion garaje', 'instalacion garaje', 'limpieza garaje'
    ],
    en: [
      'garage', 'carport', 'parking',
      'garage door', 'sectional door', 'overhead door', 'roll-up door',
      'opener', 'door opener', 'remote', 'motor',
      'shelving', 'shelves', 'organization', 'organizer', 'storage',
      'epoxy floor', 'epoxy', 'flooring', 'lighting', 'ventilation',
      'repair door', 'install door', 'replace motor', 'garage maintenance',
      // Contextual phrases
      'garage door repair', 'garage door installation', 'garage opener repair',
      'garage organization', 'garage shelving', 'garage flooring',
      'garage cleaning', 'garage makeover'
    ]
  },
  'Climatización': {
    es: [
      'hvac', 'aire acondicionado', 'minisplit', 'mini split', 'clima', 'climatizacion',
      'refrigeracion', 'ventilacion', 'calefaccion', 'ac', 'aa',
      'gas refrigerante', 'recarga gas', 'compresor', 'condensador', 'evaporador',
      'ducto', 'ductos', 'termostato', 'control remoto',
      'calenton', 'calentador', 'radiador', 'bomba calor',
      // Frases contextuales
      'instalar aire', 'mantenimiento aire', 'reparar aire', 'limpieza aire',
      'no enfria', 'no calienta', 'tira agua', 'hace ruido', 'huele feo', 'huele mal',
      'instalar calefaccion', 'sistema climatizacion'
    ],
    en: [
      'hvac', 'air conditioning', 'air conditioner', 'ac', 'mini split', 'minisplit',
      'cooling', 'heating', 'ventilation', 'duct', 'ducts', 'thermostat',
      'refrigerant', 'compressor', 'condenser', 'evaporator',
      'furnace', 'heat pump', 'heater', 'radiator', 'boiler',
      // Contextual phrases
      'install ac', 'ac repair', 'ac maintenance', 'ac not cooling',
      'ac leaking', 'ac noisy', 'clean ac', 'ac service',
      'install heating', 'heating system', 'hvac service'
    ]
  },
  'Piscinas': {
    es: [
      'piscina', 'piscinas', 'alberca', 'albercas', 'pileta',
      'agua piscina', 'cloro', 'cloracion', 'quimica agua', 'ph',
      'bomba piscina', 'filtro piscina', 'filtro', 'filtros', 'skimmer',
      'azulejo piscina', 'liner', 'revestimiento', 'jacuzzi', 'spa',
      'limpieza piscina', 'aspiradora piscina', 'robot piscina',
      'trampa pelo', 'calentador piscina', 'iluminacion piscina',
      // Frases contextuales
      'mantenimiento piscina', 'limpiar piscina', 'reparar piscina',
      'construir piscina', 'agua verde', 'agua turbia', 'piscina sucia',
      'instalar bomba piscina', 'cambiar filtro piscina', 'vaciar piscina'
    ],
    en: [
      'pool', 'pools', 'swimming pool', 'swimming',
      'chlorine', 'chlorination', 'water chemistry', 'ph',
      'pool pump', 'pool filter', 'filter', 'filters', 'skimmer',
      'pool tile', 'liner', 'resurfacing', 'jacuzzi', 'spa', 'hot tub',
      'pool cleaning', 'pool vacuum', 'pool robot',
      'pool heater', 'pool light', 'pool lighting',
      // Contextual phrases
      'pool maintenance', 'clean pool', 'repair pool',
      'build pool', 'green water', 'cloudy water', 'dirty pool',
      'install pool pump', 'change pool filter', 'drain pool'
    ]
  },
  'Pérgolas': {
    es: [
      'pergola', 'pergolas', 'toldo', 'toldos', 'sombrilla', 'sombrillas',
      'estructura exterior', 'sombra', 'cubierta exterior',
      'terraza', 'terrazas', 'patio', 'patios', 'jardin', 'jardines',
      'madera exterior', 'aluminio', 'policarbonato', 'lona',
      'columna', 'columnas', 'viga', 'vigas', 'poste', 'postes',
      'gazebo', 'cenador', 'kiosco', 'palapa',
      // Frases contextuales
      'instalar pergola', 'construir pergola', 'reparar pergola',
      'pergola madera', 'pergola aluminio', 'pergola terraza',
      'dar sombra', 'cubierta patio', 'techo terraza', 'proteccion solar'
    ],
    en: [
      'pergola', 'pergolas', 'awning', 'awnings', 'canopy', 'shade',
      'outdoor structure', 'shade structure', 'outdoor cover',
      'terrace', 'patio', 'deck', 'garden', 'backyard',
      'outdoor wood', 'aluminum', 'polycarbonate', 'canvas',
      'column', 'columns', 'beam', 'beams', 'post', 'posts',
      'gazebo', 'pavilion', 'arbor',
      // Contextual phrases
      'install pergola', 'build pergola', 'repair pergola',
      'wood pergola', 'aluminum pergola', 'patio pergola',
      'provide shade', 'patio cover', 'deck cover', 'sun protection'
    ]
  },
  'Cercas': {
    es: [
      'cerca', 'cercas', 'cerco', 'cercos', 'valla', 'vallas', 'barda', 'bardas',
      'reja', 'rejas', 'portón', 'portones', 'malla', 'malla ciclonica',
      'alambre', 'alambrado', 'poste', 'postes', 'estaca', 'estacas',
      'madera', 'hierro', 'acero', 'vinilo', 'metal',
      'privacidad', 'seguridad', 'perimetral', 'perimetro',
      // Frases contextuales
      'instalar cerca', 'poner cerca', 'reparar cerca', 'cambiar cerca',
      'cerca madera', 'cerca metal', 'cerca jardin', 'cerca perimetral',
      'cercar terreno', 'delimitar propiedad', 'cerca rota', 'barda caida'
    ],
    en: [
      'fence', 'fences', 'fencing', 'gate', 'gates',
      'railing', 'railings', 'picket', 'picket fence',
      'chain link', 'wire', 'post', 'posts', 'stake', 'stakes',
      'wood', 'iron', 'steel', 'vinyl', 'metal', 'aluminum',
      'privacy', 'security', 'perimeter', 'boundary',
      // Contextual phrases
      'install fence', 'build fence', 'repair fence', 'replace fence',
      'wood fence', 'metal fence', 'garden fence', 'privacy fence',
      'fence property', 'broken fence', 'fence fallen', 'new fence'
    ]
  },
  'Techado': {
    es: [
      'techo', 'techos', 'techado', 'techumbre', 'tejado', 'tejados',
      'teja', 'tejas', 'lamina', 'laminas', 'impermeabilizacion',
      'impermeabilizar', 'impermeabilizante', 'gotera', 'goteras',
      'canalon', 'canalones', 'canaleta', 'bajante', 'bajantes',
      'aislamiento', 'aislante', 'fibra vidrio', 'poliuretano',
      'tragaluz', 'claraboya', 'ventilador techo',
      // Frases contextuales
      'reparar techo', 'arreglar techo', 'cambiar techo', 'instalar techo',
      'gotera techo', 'techo gotea', 'filtracion techo', 'techo danado',
      'impermeabilizar techo', 'limpiar canalones', 'techo nuevo'
    ],
    en: [
      'roof', 'roofing', 'rooftop', 'roofer',
      'shingle', 'shingles', 'tile', 'tiles', 'metal roof',
      'waterproofing', 'waterproof', 'leak', 'leaks', 'leaky roof',
      'gutter', 'gutters', 'downspout', 'downspouts',
      'insulation', 'fiberglass', 'polyurethane',
      'skylight', 'attic', 'soffit', 'fascia', 'flashing',
      // Contextual phrases
      'repair roof', 'fix roof', 'replace roof', 'install roof',
      'roof leak', 'leaking roof', 'roof damage', 'damaged roof',
      'waterproof roof', 'clean gutters', 'new roof'
    ]
  },
  'Remodelación': {
    es: [
      'remodelacion', 'remodelar', 'renovacion', 'renovar',
      'construccion', 'construir', 'constructor', 'contratista',
      'ampliacion', 'ampliar', 'edificar',
      'albanil', 'albanileria', 'mamposteria', 'obra', 'obras',
      'cemento', 'concreto', 'ladrillo', 'block', 'bloque',
      'cocina', 'bano', 'sala', 'habitacion', 'cuarto',
      'ingeniero', 'arquitecto', 'plano', 'planos', 'diseño',
      'estructura', 'cimiento', 'cimientos', 'columna', 'losa',
      // Frases contextuales
      'remodelar casa', 'remodelar cocina', 'remodelar bano',
      'ampliar casa', 'renovar casa', 'proyecto construccion',
      'segundo piso', 'cuarto extra', 'hacer cuarto',
      'obra gris', 'acabados', 'remodelacion integral'
    ],
    en: [
      'remodel', 'remodeling', 'renovation', 'renovate', 'revamp',
      'construction', 'build', 'building', 'builder', 'contractor',
      'extension', 'expand', 'addition',
      'mason', 'masonry', 'brickwork',
      'cement', 'concrete', 'brick', 'block',
      'kitchen', 'bathroom', 'living room', 'bedroom', 'room',
      'engineer', 'architect', 'blueprint', 'plans', 'design',
      'structure', 'foundation', 'column', 'slab',
      // Contextual phrases
      'remodel house', 'remodel kitchen', 'remodel bathroom',
      'expand house', 'renovate house', 'construction project',
      'second floor', 'extra room', 'add room',
      'home improvement', 'full renovation', 'gut renovation'
    ]
  },
  'Cerrajería': {
    es: [
      'cerrajero', 'cerrajeria', 'cerradura', 'cerraduras', 'llave', 'llaves',
      'candado', 'candados', 'chapa', 'chapas', 'pestillo',
      'duplicar llave', 'copia llave', 'puerta trabada',
      'cerradura digital', 'cerradura inteligente', 'cerradura electronica',
      'caja fuerte', 'combinacion', 'seguridad',
      // Frases contextuales
      'cambiar cerradura', 'hacer llave', 'me quede afuera', 'perdi llave',
      'puerta no abre', 'no abre puerta', 'instalar cerradura',
      'cerradura rota', 'llave rota', 'abrir puerta', 'emergencia cerrajero'
    ],
    en: [
      'locksmith', 'lock', 'locks', 'key', 'keys', 'padlock', 'deadbolt',
      'latch', 'bolt', 'keyless', 'smart lock', 'electronic lock',
      'safe', 'combination', 'security',
      // Contextual phrases
      'change lock', 'duplicate key', 'copy key', 'locked out',
      'lost key', 'broken lock', 'door wont open', 'install lock',
      'open door', 'key stuck', 'emergency locksmith'
    ]
  },
  'Control de Plagas': {
    es: [
      'control plagas', 'fumigacion', 'fumigar', 'fumigador', 'plaga', 'plagas',
      'insecto', 'insectos', 'cucaracha', 'cucarachas', 'hormiga', 'hormigas',
      'raton', 'ratones', 'rata', 'ratas', 'chinche', 'chinches',
      'termita', 'termitas', 'arana', 'aranas', 'alacran', 'alacranes',
      'exterminador', 'veneno', 'desratizacion', 'desinsectacion',
      'mosquito', 'mosquitos', 'mosca', 'moscas', 'polilla', 'polillas',
      // Frases contextuales
      'eliminar plagas', 'matar cucarachas', 'hay ratones', 'tengo plagas',
      'bichos casa', 'insectos casa', 'problema plagas', 'plaga termitas'
    ],
    en: [
      'pest control', 'fumigation', 'fumigate', 'exterminator', 'extermination',
      'pest', 'pests', 'insect', 'insects', 'bug', 'bugs',
      'cockroach', 'cockroaches', 'roach', 'ant', 'ants', 'mouse', 'mice', 'rat', 'rats',
      'bedbug', 'bedbugs', 'termite', 'termites', 'spider', 'spiders',
      'mosquito', 'mosquitoes', 'fly', 'flies', 'moth', 'moths',
      // Contextual phrases
      'kill roaches', 'get rid bugs', 'pest problem', 'insect infestation',
      'mice problem', 'bug spray', 'termite treatment', 'pest inspection'
    ]
  },
  'Pisos': {
    es: [
      'piso', 'pisos', 'suelo', 'suelos', 'pavimento',
      'azulejo', 'azulejos', 'loseta', 'losetas', 'baldosa', 'baldosas',
      'ceramica', 'porcelanato', 'marmol', 'granito', 'cantera',
      'madera', 'duela', 'parquet', 'laminado', 'vinilico', 'vinyl',
      'alfombra', 'tapete', 'moqueta', 'epoxy', 'epoxico',
      'pulido', 'pulir', 'nivelacion', 'nivelar', 'lechada',
      // Frases contextuales
      'instalar piso', 'cambiar piso', 'reparar piso', 'poner piso',
      'piso cocina', 'piso bano', 'piso madera', 'piso ceramica',
      'pulir piso', 'nivelar piso', 'piso danado', 'piso roto'
    ],
    en: [
      'floor', 'floors', 'flooring', 'tile', 'tiles', 'tiling',
      'ceramic', 'porcelain', 'marble', 'granite', 'stone',
      'hardwood', 'laminate', 'vinyl', 'linoleum',
      'carpet', 'carpeting', 'rug', 'epoxy',
      'polish', 'polishing', 'leveling', 'grout', 'grouting',
      // Contextual phrases
      'install floor', 'replace floor', 'repair floor', 'lay floor',
      'kitchen floor', 'bathroom floor', 'wood floor', 'tile floor',
      'polish floor', 'level floor', 'damaged floor', 'broken tile'
    ]
  },
  'Jardinería': {
    es: [
      'jardin', 'jardines', 'jardinero', 'jardineria', 'cesped', 'pasto', 'grama',
      'planta', 'plantas', 'arbol', 'arboles', 'arbusto', 'arbustos',
      'poda', 'podar', 'cortar', 'cortar cesped', 'cortacesped',
      'riego', 'irrigacion', 'aspersor', 'aspersores', 'manguera',
      'fertilizante', 'abono', 'tierra', 'composta', 'mulch', 'mantillo',
      'maleza', 'hierba mala', 'deshierbar', 'paisajismo',
      'flor', 'flores', 'maceta', 'jardinera', 'cantero',
      // Frases contextuales
      'cortar cesped', 'podar arbol', 'plantar flores', 'instalar riego',
      'disenar jardin', 'mantener jardin', 'limpiar jardin',
      'quitar maleza', 'poner cesped', 'cuidar plantas'
    ],
    en: [
      'garden', 'gardening', 'gardener', 'yard', 'lawn', 'grass', 'turf',
      'plant', 'plants', 'tree', 'trees', 'shrub', 'shrubs', 'bush', 'bushes',
      'prune', 'pruning', 'trim', 'trimming', 'mow', 'mowing', 'mower',
      'irrigation', 'sprinkler', 'sprinklers', 'hose', 'watering',
      'fertilizer', 'compost', 'soil', 'mulch', 'mulching',
      'weed', 'weeds', 'weeding', 'landscaping', 'landscape',
      'flower', 'flowers', 'planter', 'bed', 'beds',
      // Contextual phrases
      'mow lawn', 'trim trees', 'plant flowers', 'install irrigation',
      'landscape design', 'yard maintenance', 'clean garden',
      'pull weeds', 'lay sod', 'garden care'
    ]
  },
  'Ventanas': {
    es: [
      'ventana', 'ventanas', 'vidrio', 'vidrios', 'cristal', 'cristales',
      'mosquitero', 'mosquiteros', 'malla', 'persiana', 'persianas',
      'cortina', 'cortinas', 'estor', 'estores', 'celosia',
      'marco ventana', 'sellado', 'sellar', 'burletes', 'aislamiento',
      'doble vidrio', 'doble cristal', 'polarizado', 'film', 'pelicula solar',
      'cancel', 'canceles', 'ventanal', 'ventanales',
      // Frases contextuales
      'cambiar vidrio', 'reparar ventana', 'instalar ventana',
      'vidrio roto', 'ventana rota', 'sellar ventana',
      'instalar persiana', 'poner cortina', 'mosquitero roto',
      'ventana no cierra', 'eficiencia energetica'
    ],
    en: [
      'window', 'windows', 'glass', 'pane', 'panes',
      'screen', 'screens', 'blind', 'blinds', 'shade', 'shades',
      'curtain', 'curtains', 'shutter', 'shutters',
      'window frame', 'seal', 'sealing', 'weatherstrip', 'insulation',
      'double pane', 'double glazing', 'tint', 'tinting', 'film', 'solar film',
      'sliding door', 'bay window', 'picture window',
      // Contextual phrases
      'replace glass', 'repair window', 'install window',
      'broken glass', 'broken window', 'seal window',
      'install blinds', 'hang curtains', 'fix screen',
      'window wont close', 'energy efficient window'
    ]
  },
  'Construcción': {
    es: [
      'construccion', 'construir', 'constructor', 'contratista', 'obra',
      'cimiento', 'cimientos', 'fundacion', 'cimentacion',
      'estructura', 'estructural', 'columna', 'columnas', 'viga', 'vigas',
      'concreto', 'cemento', 'hormigon', 'varilla', 'acero', 'fierro',
      'tablaroca', 'drywall', 'plafon', 'yeso',
      'albanil', 'albanileria', 'mamposteria', 'ladrillo', 'block', 'bloque',
      'terreno', 'nivelacion', 'excavacion', 'demolicion',
      'permiso', 'permisos', 'licencia construccion',
      // Frases contextuales
      'construir casa', 'obra nueva', 'preparar terreno',
      'colar losa', 'levantar muro', 'hacer cimientos',
      'proyecto construccion', 'obra civil', 'segunda planta'
    ],
    en: [
      'construction', 'build', 'building', 'builder', 'contractor',
      'foundation', 'footing', 'slab', 'base',
      'structure', 'structural', 'column', 'beam', 'framing', 'frame',
      'concrete', 'cement', 'rebar', 'steel', 'iron',
      'drywall', 'sheetrock', 'plaster', 'stud', 'studs',
      'mason', 'masonry', 'brick', 'block', 'cinder block',
      'grading', 'excavation', 'demolition', 'site prep',
      'permit', 'permits', 'building permit',
      // Contextual phrases
      'build house', 'new construction', 'site preparation',
      'pour slab', 'raise wall', 'lay foundation',
      'construction project', 'civil work', 'second story'
    ]
  },
  'Mudanzas': {
    es: [
      'mudanza', 'mudanzas', 'mudar', 'mudarse', 'mover', 'trasladar',
      'empacar', 'empacar', 'embalar', 'desempacar', 'desembalar',
      'carga', 'descarga', 'transporte', 'camion mudanza', 'fletes', 'flete',
      'bodega', 'almacen', 'almacenaje', 'guardamuebles',
      'mueble pesado', 'piano', 'caja', 'cajas', 'empaque',
      'oficina', 'local', 'departamento',
      // Frases contextuales
      'mover muebles', 'cambiar casa', 'mudarme', 'me mudo',
      'necesito mudanza', 'servicio mudanza', 'empacar cosas',
      'mudanza local', 'mudanza larga distancia', 'sacar muebles',
      'tirar cosas', 'desechar muebles'
    ],
    en: [
      'moving', 'move', 'movers', 'mover', 'relocation', 'relocate',
      'pack', 'packing', 'unpack', 'unpacking', 'box', 'boxes',
      'load', 'unload', 'transport', 'truck', 'hauling', 'haul',
      'storage', 'warehouse', 'self storage',
      'heavy furniture', 'piano', 'appliance', 'fragile',
      'office', 'apartment', 'house',
      // Contextual phrases
      'move furniture', 'change house', 'moving out', 'moving in',
      'need movers', 'moving service', 'pack things',
      'local move', 'long distance move', 'junk removal',
      'dispose furniture', 'throw away'
    ]
  },
  'Seguridad': {
    es: [
      'seguridad', 'vigilancia', 'proteccion', 'alarma', 'alarmas',
      'camara', 'camaras', 'cctv', 'videoportero', 'interfon', 'intercom',
      'sensor', 'sensores', 'movimiento', 'detector', 'detectores',
      'monitoreo', 'control acceso', 'cerradura electronica',
      'domotica', 'casa inteligente', 'automatizacion', 'smart home',
      'luz sensor', 'reflector', 'cerca electrica',
      // Frases contextuales
      'instalar camaras', 'poner alarma', 'sistema seguridad',
      'vigilancia remota', 'monitoreo 24 horas', 'proteger casa',
      'seguridad hogar', 'instalar sensores', 'control acceso casa'
    ],
    en: [
      'security', 'surveillance', 'protection', 'alarm', 'alarms',
      'camera', 'cameras', 'cctv', 'doorbell', 'intercom', 'video doorbell',
      'sensor', 'sensors', 'motion', 'detector', 'detectors',
      'monitoring', 'access control', 'smart lock', 'electronic lock',
      'smart home', 'home automation', 'automation',
      'security light', 'floodlight', 'electric fence',
      // Contextual phrases
      'install cameras', 'set alarm', 'security system',
      'remote monitoring', '24 hour monitoring', 'protect home',
      'home security', 'install sensors', 'home access control'
    ]
  }
};

/**
 * Stopwords bilingües — palabras que se ignoran en el análisis NLP
 * (artículos, preposiciones, pronombres comunes sin valor semántico para búsqueda)
 */
export const STOPWORDS = new Set([
  // Español
  'el', 'la', 'los', 'las', 'un', 'una', 'unos', 'unas',
  'de', 'del', 'en', 'por', 'para', 'con', 'sin', 'sobre',
  'que', 'como', 'pero', 'mas', 'muy', 'este', 'esta', 'esto',
  'ese', 'esa', 'eso', 'mi', 'tu', 'su', 'nos', 'les',
  'me', 'te', 'se', 'lo', 'le', 'ya', 'hay', 'ser', 'estar',
  'al', 'he', 'ha', 'han', 'hemos',
  'necesito', 'busco', 'quiero', 'tengo', 'estoy', 'puedo',
  'alguien', 'quien', 'donde', 'cuando', 'ayuda', 'favor',
  // English
  'the', 'a', 'an', 'of', 'in', 'on', 'at', 'for', 'to',
  'with', 'from', 'by', 'is', 'are', 'was', 'were', 'be',
  'been', 'has', 'have', 'had', 'do', 'does', 'did',
  'it', 'its', 'my', 'your', 'his', 'her', 'our', 'their',
  'this', 'that', 'these', 'those', 'and', 'or', 'but', 'not',
  'so', 'if', 'no', 'yes', 'can', 'will', 'just', 'than',
  'need', 'want', 'looking', 'find', 'help', 'someone', 'please'
]);

/**
 * Busca categorías que coinciden con el texto de búsqueda.
 * Sistema de SCORING ponderado — cada tipo de match aporta puntos distintos.
 * Solo devuelve categorías que superan un umbral mínimo de confianza.
 *
 * Pesos (de mayor a menor confianza):
 *   100  — nombre de categoría contenido en el texto
 *    90  — keyword multi-palabra encontrada en el texto completo
 *    80  — palabra del usuario === keyword exacta
 *    60  — prefijo (keyword.startsWith(word) o viceversa, mínimo 5 chars)
 *    50  — bigram/trigram === keyword exacta
 *    35  — bigram/trigram contiene keyword (keyword ≥ 4 chars)
 *    20  — fuzzy match (Levenshtein, solo palabras ≥ 5 chars, maxDist dinámico)
 *
 * Umbral: solo se devuelven categorías con score ≥ 50
 *
 * @param {string} searchText - Texto de búsqueda del usuario
 * @returns {Set<string>} - Set de categorías que matchean con suficiente confianza
 */
export function findMatchingCategories(searchText) {
  if (!searchText || typeof searchText !== 'string') return new Set();

  const normalizedSearch = normalizeText(searchText);
  /** @type {Record<string, number>} categoryScores */
  const categoryScores = {};

  // Extraer palabras significativas (sin stopwords, longitud mínima 2)
  const words = normalizedSearch
    .split(/\s+/)
    .filter(w => w.length >= 2 && !STOPWORDS.has(w));

  // Bi-grams (incluyen stopwords para preservar frases como "aire acondicionado")
  const bigrams = [];
  const allWords = normalizedSearch.split(/\s+/).filter(w => w.length >= 2);
  for (let i = 0; i < allWords.length - 1; i++) {
    bigrams.push(`${allWords[i]} ${allWords[i + 1]}`);
  }
  // Tri-grams
  const trigrams = [];
  for (let i = 0; i < allWords.length - 2; i++) {
    trigrams.push(`${allWords[i]} ${allWords[i + 1]} ${allWords[i + 2]}`);
  }

  const addScore = (cat, points) => {
    categoryScores[cat] = (categoryScores[cat] || 0) + points;
  };

  for (const [category, langs] of Object.entries(SEARCH_KEYWORDS)) {
    const allKeywords = [...(langs.es || []), ...(langs.en || [])];
    const normalizedKeywords = allKeywords.map(normalizeText);

    // 1. Match directo de categoría normalizada (100 pts)
    const normalizedCategory = normalizeText(category);
    if (normalizedSearch.includes(normalizedCategory) || normalizedCategory.includes(normalizedSearch)) {
      addScore(category, 100);
    }

    // 2. Keywords multi-palabra encontradas en el texto completo (90 pts)
    for (const nk of normalizedKeywords) {
      if (nk.includes(' ') && normalizedSearch.includes(nk)) {
        addScore(category, 90);
        break; // Un match multi-word es suficiente
      }
    }

    // 3. Palabra del usuario === keyword exacta (80 pts)
    let exactMatched = false;
    for (const word of words) {
      if (exactMatched) break;
      for (const nk of normalizedKeywords) {
        if (nk === word) {
          addScore(category, 80);
          exactMatched = true;
          break;
        }
      }
    }

    // 4. Prefix matching — requiere mínimo 5 chars en ambos lados (60 pts)
    if (!exactMatched) {
      let prefixMatched = false;
      for (const word of words) {
        if (prefixMatched) break;
        if (word.length < 5) continue;
        for (const nk of normalizedKeywords) {
          if (nk.includes(' ')) continue;
          if (nk.length < 5) continue;
          if (nk.startsWith(word) || word.startsWith(nk)) {
            addScore(category, 60);
            prefixMatched = true;
            break;
          }
        }
      }
    }

    // 5. Bigram/Trigram matching (50 pts exacto, 35 pts substring con kw ≥ 4 chars)
    let ngramMatched = false;
    for (const ng of [...bigrams, ...trigrams]) {
      if (ngramMatched) break;
      for (const nk of normalizedKeywords) {
        if (nk === ng) {
          addScore(category, 50);
          ngramMatched = true;
          break;
        }
        // Substring: solo si keyword tiene 4+ chars (evita "ad", "it", "ac" como false positives)
        if (nk.length >= 4 && ng.includes(nk)) {
          addScore(category, 35);
          ngramMatched = true;
          break;
        }
        if (nk.length >= 4 && nk.includes(ng)) {
          addScore(category, 35);
          ngramMatched = true;
          break;
        }
      }
    }

    // 6. Fuzzy matching — solo palabras ≥ 5 chars, maxDist dinámico (20 pts)
    //    5-6 chars → maxDist 1 | 7+ chars → maxDist 2
    let fuzzyMatched = false;
    for (const word of words) {
      if (fuzzyMatched) break;
      if (word.length < 5) continue; // Requiere 5+ chars (evita aire↔wire, aire↔tire)
      for (const nk of normalizedKeywords) {
        if (nk.includes(' ')) continue;
        if (nk.length < 5) continue; // Keyword también 5+ chars
        if (nk === word) continue; // Ya contado en Step 3
        const dynamicMax = (Math.min(word.length, nk.length) <= 6) ? 1 : 2;
        if (isFuzzyMatch(word, nk, dynamicMax)) {
          addScore(category, 20);
          fuzzyMatched = true;
          break;
        }
      }
    }
  }

  // Filtrar por umbral mínimo de confianza (50 puntos)
  const THRESHOLD = 50;
  const result = new Set();
  for (const [cat, score] of Object.entries(categoryScores)) {
    if (score >= THRESHOLD) result.add(cat);
  }
  return result;
}

/**
 * Versión para sugerencias en tiempo real — devuelve categorías con score, ordenadas por confianza
 * @param {string} searchText
 * @returns {Array<{category: string, score: number}>}
 */
export function getSuggestions(searchText) {
  if (!searchText || searchText.trim().length < 2) return [];

  // Reutilizar la lógica de scoring pero necesitamos los scores
  const normalizedSearch = normalizeText(searchText.trim());
  const categoryScores = {};

  const words = normalizedSearch
    .split(/\s+/)
    .filter(w => w.length >= 2 && !STOPWORDS.has(w));

  const bigrams = [];
  const allWords = normalizedSearch.split(/\s+/).filter(w => w.length >= 2);
  for (let i = 0; i < allWords.length - 1; i++) {
    bigrams.push(`${allWords[i]} ${allWords[i + 1]}`);
  }
  const trigrams = [];
  for (let i = 0; i < allWords.length - 2; i++) {
    trigrams.push(`${allWords[i]} ${allWords[i + 1]} ${allWords[i + 2]}`);
  }

  const addScore = (cat, points) => {
    categoryScores[cat] = (categoryScores[cat] || 0) + points;
  };

  for (const [category, langs] of Object.entries(SEARCH_KEYWORDS)) {
    const allKeywords = [...(langs.es || []), ...(langs.en || [])];
    const normalizedKeywords = allKeywords.map(normalizeText);

    const normalizedCategory = normalizeText(category);
    if (normalizedSearch.includes(normalizedCategory) || normalizedCategory.includes(normalizedSearch)) {
      addScore(category, 100);
    }

    for (const nk of normalizedKeywords) {
      if (nk.includes(' ') && normalizedSearch.includes(nk)) {
        addScore(category, 90);
        break;
      }
    }

    let exactMatched = false;
    for (const word of words) {
      if (exactMatched) break;
      for (const nk of normalizedKeywords) {
        if (nk === word) { addScore(category, 80); exactMatched = true; break; }
      }
    }

    if (!exactMatched) {
      let prefixMatched = false;
      for (const word of words) {
        if (prefixMatched) break;
        if (word.length < 5) continue;
        for (const nk of normalizedKeywords) {
          if (nk.includes(' ') || nk.length < 5) continue;
          if (nk.startsWith(word) || word.startsWith(nk)) { addScore(category, 60); prefixMatched = true; break; }
        }
      }
    }

    let ngramMatched = false;
    for (const ng of [...bigrams, ...trigrams]) {
      if (ngramMatched) break;
      for (const nk of normalizedKeywords) {
        if (nk === ng) { addScore(category, 50); ngramMatched = true; break; }
        if (nk.length >= 4 && (ng.includes(nk) || nk.includes(ng))) { addScore(category, 35); ngramMatched = true; break; }
      }
    }

    let fuzzyMatched = false;
    for (const word of words) {
      if (fuzzyMatched) break;
      if (word.length < 5) continue;
      for (const nk of normalizedKeywords) {
        if (nk.includes(' ') || nk.length < 5 || nk === word) continue;
        const dynamicMax = (Math.min(word.length, nk.length) <= 6) ? 1 : 2;
        if (isFuzzyMatch(word, nk, dynamicMax)) { addScore(category, 20); fuzzyMatched = true; break; }
      }
    }
  }

  const THRESHOLD = 50;
  return Object.entries(categoryScores)
    .filter(([, score]) => score >= THRESHOLD)
    .sort((a, b) => b[1] - a[1])
    .map(([category, score]) => ({ category, score }));
}
