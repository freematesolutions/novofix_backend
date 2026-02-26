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
 * Diccionario bilingüe de keywords por categoría
 * Estructura: { category: { es: [...], en: [...] } }
 * Incluye: nombres directos, sinónimos, objetos relacionados, problemas comunes, frases contextuales
 */
export const SEARCH_KEYWORDS = {
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
  'Carpintería': {
    es: [
      'carpintero', 'carpinteria', 'madera', 'mueble', 'muebles', 'puerta', 'puertas',
      'ventana', 'ventanas', 'closet', 'closets', 'armario', 'armarios',
      'estante', 'estantes', 'librero', 'libreros', 'mesa', 'mesas', 'silla', 'sillas',
      'gabinete', 'gabinetes', 'cocina integral', 'piso madera', 'duela', 'parquet',
      'pergola', 'deck', 'moldura', 'molduras', 'marco', 'marcos',
      'tablon', 'tablones', 'contrachapado', 'triplay', 'mdf',
      // Frases contextuales
      'reparar mueble', 'hacer mueble', 'instalar puerta', 'arreglar ventana',
      'trabajos madera', 'mueble medida', 'restaurar mueble', 'mesa rota',
      'puerta rota', 'silla rota', 'mueble danado'
    ],
    en: [
      'carpenter', 'carpentry', 'wood', 'wooden', 'woodwork', 'woodworking',
      'furniture', 'door', 'doors', 'window', 'windows', 'closet', 'closets',
      'cabinet', 'cabinets', 'shelf', 'shelves', 'bookshelf', 'bookcase',
      'table', 'chair', 'desk', 'wardrobe', 'dresser', 'nightstand',
      'deck', 'pergola', 'molding', 'trim', 'frame', 'hardwood', 'plywood',
      // Contextual phrases
      'fix furniture', 'repair door', 'broken table', 'broken chair',
      'custom furniture', 'install door', 'fix window', 'damaged wood',
      'build shelf', 'wooden floor'
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
  'Limpieza': {
    es: [
      'limpieza', 'limpiar', 'limpiador', 'aseo', 'asear',
      'desinfeccion', 'desinfectar', 'sanitizar', 'sanitizacion',
      'aspirar', 'trapear', 'barrer', 'pulir', 'brillar', 'lavar',
      'detergente', 'domestico', 'domestica', 'mucama', 'empleada hogar',
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
      // Contextual phrases
      'clean house', 'clean office', 'clean apartment',
      'deep cleaning', 'house cleaning', 'cleaning service',
      'spring cleaning', 'move out cleaning', 'post construction cleaning'
    ]
  },
  'Jardinería': {
    es: [
      'jardinero', 'jardineria', 'jardin', 'jardines', 'poda', 'podar',
      'cesped', 'pasto', 'grama', 'planta', 'plantas', 'regar', 'riego',
      'plantar', 'sembrar', 'fertilizar', 'fertilizante', 'abono',
      'arbol', 'arboles', 'flor', 'flores', 'maceta', 'macetas', 'tierra',
      'paisajismo', 'podadora', 'cortadora', 'seto', 'setos', 'enredadera',
      // Frases contextuales
      'cortar pasto', 'cortar cesped', 'mantenimiento jardin', 'diseño jardin',
      'podar arboles', 'regar plantas', 'jardin descuidado'
    ],
    en: [
      'gardener', 'gardening', 'garden', 'gardens', 'lawn', 'grass',
      'pruning', 'prune', 'trim', 'trimming', 'mowing', 'mow',
      'plant', 'plants', 'planting', 'watering', 'irrigation',
      'fertilizer', 'fertilize', 'compost', 'soil',
      'tree', 'trees', 'flower', 'flowers', 'hedge', 'hedges', 'bush', 'bushes',
      'landscaping', 'landscape',
      // Contextual phrases
      'mow lawn', 'cut grass', 'garden maintenance', 'trim hedges',
      'plant flowers', 'overgrown yard', 'yard work'
    ]
  },
  'Cerrajería': {
    es: [
      'cerrajero', 'cerrajeria', 'cerradura', 'cerraduras', 'llave', 'llaves',
      'candado', 'candados', 'chapa', 'chapas', 'pestillo',
      'duplicar llave', 'copia llave', 'puerta trabada',
      // Frases contextuales
      'cambiar cerradura', 'hacer llave', 'me quede afuera', 'perdi llave',
      'puerta no abre', 'no abre puerta', 'instalar cerradura',
      'cerradura rota', 'llave rota', 'abrir puerta'
    ],
    en: [
      'locksmith', 'lock', 'locks', 'key', 'keys', 'padlock', 'deadbolt',
      'latch', 'bolt', 'keyless', 'smart lock',
      // Contextual phrases
      'change lock', 'duplicate key', 'copy key', 'locked out',
      'lost key', 'broken lock', 'door wont open', 'install lock',
      'open door', 'key stuck'
    ]
  },
  'Albañilería': {
    es: [
      'albanil', 'albanileria', 'mamposteria', 'pared', 'paredes', 'muro', 'muros',
      'cemento', 'concreto', 'ladrillo', 'ladrillos', 'block', 'blocks', 'bloque', 'bloques',
      'cimiento', 'cimientos', 'columna', 'columnas', 'castillo', 'dala',
      'aplanado', 'repello', 'mezcla', 'mortero', 'firme', 'losa',
      // Frases contextuales
      'levantar pared', 'hacer cuarto', 'ampliar casa', 'reparar pared',
      'grieta', 'grietas', 'resane pared', 'construir', 'obra gris',
      'hacer barda', 'cuarto extra'
    ],
    en: [
      'mason', 'masonry', 'bricklayer', 'brickwork', 'brick', 'bricks',
      'wall', 'walls', 'cement', 'concrete', 'mortar', 'block', 'blocks',
      'foundation', 'column', 'pillar', 'slab',
      'plaster', 'plastering', 'stucco',
      // Contextual phrases
      'build wall', 'repair wall', 'crack wall', 'cracked wall',
      'add room', 'extend house', 'foundation repair'
    ]
  },
  'Reparación de electrodomésticos': {
    es: [
      'electrodomestico', 'electrodomesticos', 'lavadora', 'lavadoras',
      'refrigerador', 'refrigeradores', 'nevera', 'neveras', 'heladera',
      'estufa', 'estufas', 'cocina', 'horno', 'hornos', 'microondas',
      'licuadora', 'cafetera', 'tostador', 'secadora', 'lavavajillas',
      'aspiradora', 'ventilador',
      'tecnico', 'reparacion', 'servicio tecnico',
      // Frases contextuales
      'no funciona', 'no prende', 'no enciende', 'no enfria', 'no calienta',
      'hace ruido', 'reparar lavadora', 'arreglar nevera', 'arreglar refri',
      'se descompuso', 'no lava', 'no seca', 'tira agua'
    ],
    en: [
      'appliance', 'appliances', 'washer', 'washing machine', 'dryer',
      'refrigerator', 'fridge', 'freezer', 'stove', 'oven', 'microwave',
      'dishwasher', 'blender', 'coffee maker', 'toaster',
      'vacuum cleaner', 'technician', 'repair',
      // Contextual phrases
      'not working', 'wont turn on', 'not cooling', 'not heating',
      'making noise', 'fix washer', 'repair fridge', 'broken appliance',
      'leaking washer', 'not spinning'
    ]
  },
  'Instalación de aire acondicionado': {
    es: [
      'aire acondicionado', 'minisplit', 'mini split', 'clima', 'climatizacion',
      'refrigeracion', 'ventilacion', 'ac', 'aa',
      'gas refrigerante', 'recarga gas', 'compresor', 'condensador', 'evaporador',
      'ducto', 'ductos', 'termostato', 'control remoto',
      // Frases contextuales
      'instalar aire', 'mantenimiento aire', 'reparar aire', 'limpieza aire',
      'no enfria', 'tira agua', 'hace ruido', 'huele feo', 'huele mal'
    ],
    en: [
      'air conditioning', 'air conditioner', 'ac', 'hvac', 'mini split', 'minisplit',
      'cooling', 'heating', 'ventilation', 'duct', 'ducts', 'thermostat',
      'refrigerant', 'compressor', 'condenser', 'evaporator',
      // Contextual phrases
      'install ac', 'ac repair', 'ac maintenance', 'ac not cooling',
      'ac leaking', 'ac noisy', 'clean ac', 'ac service'
    ]
  },
  'Mudanzas': {
    es: [
      'mudanza', 'mudanzas', 'mudarme', 'mudar', 'transporte', 'transportar',
      'trasladar', 'traslado', 'embalaje', 'empaque', 'embalar', 'empacar',
      'cargar', 'descargar', 'flete', 'fletes', 'camion', 'camioneta',
      // Frases contextuales
      'servicio mudanza', 'transportar muebles', 'cambio casa', 'cambio oficina',
      'cambio departamento', 'me mudo', 'necesito mudanza'
    ],
    en: [
      'moving', 'move', 'movers', 'relocation', 'relocate', 'transport',
      'hauling', 'haul', 'packing', 'pack', 'unpacking', 'unpack',
      'loading', 'unloading', 'truck', 'van', 'freight',
      // Contextual phrases
      'moving service', 'move furniture', 'moving house', 'moving apartment',
      'moving office', 'need movers'
    ]
  },
  'Fumigación': {
    es: [
      'fumigacion', 'fumigar', 'fumigador', 'plaga', 'plagas',
      'insecto', 'insectos', 'cucaracha', 'cucarachas', 'hormiga', 'hormigas',
      'raton', 'ratones', 'rata', 'ratas', 'chinche', 'chinches',
      'termita', 'termitas', 'arana', 'aranas', 'alacran', 'alacranes',
      'exterminador', 'veneno', 'control plagas', 'desratizacion',
      // Frases contextuales
      'eliminar plagas', 'matar cucarachas', 'hay ratones', 'tengo plagas',
      'bichos casa', 'insectos casa'
    ],
    en: [
      'fumigation', 'fumigate', 'pest control', 'exterminator', 'extermination',
      'pest', 'pests', 'insect', 'insects', 'bug', 'bugs',
      'cockroach', 'cockroaches', 'roach', 'ant', 'ants', 'mouse', 'mice', 'rat', 'rats',
      'bedbug', 'bedbugs', 'termite', 'termites', 'spider', 'spiders',
      // Contextual phrases
      'kill roaches', 'get rid bugs', 'pest problem', 'insect infestation',
      'mice problem', 'bug spray'
    ]
  },
  'Tecnología e informática': {
    es: [
      'tecnologia', 'informatica', 'computadora', 'computadoras', 'computador',
      'ordenador', 'pc', 'laptop', 'laptops', 'portatil', 'notebook',
      'tablet', 'servidor', 'servidores', 'monitor', 'teclado', 'mouse',
      'software', 'hardware', 'internet', 'wifi', 'red', 'redes',
      'impresora', 'scanner', 'escaner', 'usb', 'disco duro',
      'virus', 'antivirus', 'malware', 'formatear', 'formateo',
      'soporte tecnico', 'tv', 'television',
      // Frases contextuales
      'reparar computadora', 'arreglar pc', 'pc lento', 'pc lenta',
      'no prende pc', 'pantalla rota', 'instalar windows', 'respaldo datos',
      'recuperar datos', 'configurar red', 'problema internet'
    ],
    en: [
      'technology', 'tech', 'it', 'computer', 'computers', 'pc', 'laptop', 'laptops',
      'notebook', 'tablet', 'server', 'servers', 'monitor', 'keyboard', 'mouse',
      'software', 'hardware', 'internet', 'wifi', 'network', 'networking',
      'printer', 'scanner', 'usb', 'hard drive', 'ssd',
      'virus', 'antivirus', 'malware', 'format', 'backup',
      'tech support', 'tv', 'television',
      // Contextual phrases
      'fix computer', 'repair pc', 'slow computer', 'pc wont start',
      'broken screen', 'install windows', 'data recovery',
      'setup network', 'internet problem'
    ]
  },
  'Clases particulares': {
    es: [
      'clase', 'clases', 'profesor', 'profesora', 'maestro', 'maestra',
      'tutor', 'tutora', 'tutoria', 'tutorias', 'ensenanza', 'educacion',
      'ensenar', 'aprender', 'regularizacion', 'apoyo escolar', 'refuerzo',
      'matematicas', 'fisica', 'quimica', 'biologia', 'historia', 'geografia',
      'ingles', 'frances', 'idioma', 'idiomas', 'musica', 'guitarra', 'piano',
      'primaria', 'secundaria', 'preparatoria', 'universidad',
      'tarea', 'tareas', 'examen', 'examenes',
      // Frases contextuales
      'necesito profesor', 'busco tutor', 'clases matematicas', 'ayuda escolar'
    ],
    en: [
      'class', 'classes', 'teacher', 'tutor', 'tutoring', 'lesson', 'lessons',
      'teaching', 'education', 'learning', 'instructor',
      'math', 'mathematics', 'physics', 'chemistry', 'biology', 'history',
      'english', 'french', 'spanish', 'language', 'languages', 'music', 'guitar', 'piano',
      'elementary', 'middle school', 'high school', 'college', 'university',
      'homework', 'exam', 'exams', 'test prep',
      // Contextual phrases
      'need teacher', 'find tutor', 'math classes', 'homework help',
      'private lessons', 'online classes'
    ]
  },
  'Belleza y estética': {
    es: [
      'belleza', 'estetica', 'peluqueria', 'salon', 'estilista',
      'cabello', 'pelo', 'corte', 'corte pelo', 'tinte', 'tintura',
      'mechas', 'alaciado', 'peinado', 'peinados',
      'maquillaje', 'maquillar', 'maquillista',
      'unas', 'manicure', 'pedicure', 'gelish', 'acrilico',
      'depilacion', 'depilar', 'cera', 'laser',
      'facial', 'faciales', 'masaje', 'masajes', 'spa',
      // Frases contextuales
      'cortar pelo', 'pintar pelo', 'hacerme unas', 'tratamiento capilar',
      'necesito estilista', 'peinar para evento'
    ],
    en: [
      'beauty', 'aesthetics', 'salon', 'stylist', 'hairdresser', 'barber',
      'hair', 'haircut', 'hairstyle', 'dye', 'highlights', 'straightening', 'perm',
      'makeup', 'make up', 'artist',
      'nails', 'manicure', 'pedicure', 'gel', 'acrylic',
      'waxing', 'wax', 'laser', 'threading',
      'facial', 'massage', 'spa', 'skincare',
      // Contextual phrases
      'cut hair', 'color hair', 'do nails', 'hair treatment',
      'need stylist', 'style hair for event'
    ]
  },
  'Mecánica automotriz': {
    es: [
      'mecanica', 'mecanico', 'auto', 'automovil', 'carro', 'coche', 'vehiculo',
      'motor', 'motores', 'afinacion', 'cambio aceite', 'aceite',
      'freno', 'frenos', 'suspension', 'amortiguador', 'amortiguadores',
      'transmision', 'clutch', 'embrague', 'bujia', 'bujias',
      'llanta', 'llantas', 'neumatico', 'rueda', 'ruedas',
      'bateria', 'acumulador', 'alternador', 'radiador', 'escape',
      'taller', 'talleres', 'diagnostico', 'scanner',
      // Frases contextuales
      'reparar auto', 'arreglar carro', 'no arranca', 'hace ruido motor',
      'humo escape', 'revision vehicular', 'servicio carro',
      'cambiar llantas', 'alinear', 'balancear'
    ],
    en: [
      'mechanic', 'mechanics', 'automotive', 'auto', 'car', 'vehicle',
      'engine', 'motor', 'tune up', 'oil change', 'oil',
      'brake', 'brakes', 'suspension', 'shock', 'shocks',
      'transmission', 'clutch', 'spark plug',
      'tire', 'tires', 'wheel', 'wheels',
      'battery', 'alternator', 'radiator', 'exhaust',
      'garage', 'workshop', 'diagnostic',
      // Contextual phrases
      'fix car', 'repair car', 'car wont start', 'engine noise',
      'exhaust smoke', 'car inspection', 'car service',
      'change tires', 'alignment', 'wheel balance'
    ]
  },
  'Fotografía': {
    es: [
      'fotografia', 'fotografo', 'foto', 'fotos', 'fotografias',
      'sesion fotografica', 'sesion fotos', 'imagen', 'imagenes',
      'boda', 'bodas', 'quinceanos', 'quincanera', 'quince anos',
      'retrato', 'retratos', 'estudio fotografico', 'book',
      'producto', 'productos', 'catalogo',
      'video', 'videografia', 'drone',
      // Frases contextuales
      'fotografiar', 'tomar fotos', 'fotos evento', 'fotos boda',
      'fotos producto', 'necesito fotografo', 'sesion embarazo'
    ],
    en: [
      'photography', 'photographer', 'photo', 'photos', 'photograph',
      'photoshoot', 'photo session', 'shoot',
      'wedding', 'portrait', 'portraits', 'studio',
      'product', 'catalog', 'catalogue',
      'video', 'videography', 'drone',
      // Contextual phrases
      'take photos', 'event photos', 'wedding photos',
      'product photos', 'need photographer', 'maternity shoot'
    ]
  },
  'Catering': {
    es: [
      'catering', 'banquete', 'banquetes', 'comida', 'cocinero', 'cocinera', 'chef',
      'buffet', 'bocadillos', 'aperitivos', 'menu', 'alimentos', 'bebidas',
      'mesero', 'meseros', 'servicio comida', 'evento',
      'pastel', 'postres', 'reposteria',
      // Frases contextuales
      'comida para evento', 'comida para fiesta', 'comida para boda',
      'necesito chef', 'servicio banquete', 'comida cumpleanos'
    ],
    en: [
      'catering', 'caterer', 'banquet', 'food', 'cook', 'cooking', 'chef',
      'buffet', 'appetizers', 'menu', 'beverages', 'drinks',
      'waiter', 'waiters', 'server', 'food service', 'event',
      'cake', 'dessert', 'desserts', 'bakery', 'baking',
      // Contextual phrases
      'food for event', 'food for party', 'food for wedding',
      'need chef', 'banquet service', 'birthday food'
    ]
  },
  'Construcción': {
    es: [
      'construccion', 'construir', 'constructor', 'constructora',
      'edificar', 'edificio', 'obra', 'obras', 'proyecto', 'proyectos',
      'remodelacion', 'remodelar', 'ampliacion', 'ampliar',
      'renovacion', 'renovar', 'remodelacion',
      'ingeniero', 'arquitecto', 'plano', 'planos',
      'estructura', 'estructural', 'cimentacion',
      // Frases contextuales
      'hacer casa', 'construir casa', 'proyecto construccion',
      'ampliar casa', 'renovar casa', 'remodelar bano',
      'remodelar cocina', 'segundo piso'
    ],
    en: [
      'construction', 'build', 'building', 'builder', 'contractor',
      'remodel', 'remodeling', 'renovation', 'renovate',
      'extension', 'expand', 'addition',
      'engineer', 'architect', 'blueprint', 'plans',
      'structure', 'structural', 'foundation',
      // Contextual phrases
      'build house', 'house construction', 'construction project',
      'expand house', 'renovate house', 'remodel bathroom',
      'remodel kitchen', 'second floor', 'home improvement'
    ]
  },
  'Decoración': {
    es: [
      'decoracion', 'decorador', 'decoradora', 'decorar',
      'interior', 'interiores', 'interiorismo', 'interiorista',
      'ambientar', 'amueblar', 'amueblamiento',
      'cortina', 'cortinas', 'persiana', 'persianas',
      'tapiz', 'tapiceria', 'alfombra', 'alfombras',
      'cuadro', 'cuadros', 'iluminacion decorativa',
      // Frases contextuales
      'diseño interior', 'diseño espacios', 'renovar casa decoracion',
      'cambiar decoracion', 'decorar sala', 'decorar departamento',
      'ambientar oficina'
    ],
    en: [
      'decoration', 'decorator', 'decorate', 'decorating',
      'interior design', 'interior designer', 'interiors',
      'furnish', 'furnishing', 'staging',
      'curtain', 'curtains', 'blinds', 'drapes',
      'upholstery', 'carpet', 'rug', 'rugs',
      'artwork', 'art', 'lighting design',
      // Contextual phrases
      'interior design', 'space design', 'home decor',
      'redecorate', 'decorate living room', 'decorate apartment',
      'office design'
    ]
  },
  'Diseño gráfico': {
    es: [
      'diseno grafico', 'disenador grafico', 'disenadora',
      'logo', 'logotipo', 'logos', 'branding', 'marca', 'identidad',
      'publicidad', 'flyer', 'flyers', 'cartel', 'carteles',
      'banner', 'banners', 'tarjeta', 'tarjetas',
      'diseno web', 'pagina web', 'sitio web', 'imagen corporativa',
      'ilustracion', 'ilustrador', 'infografia',
      // Frases contextuales
      'crear logo', 'diseño logo', 'diseñar logo', 'necesito logo',
      'hacer tarjetas', 'diseñar publicidad', 'imagen empresa'
    ],
    en: [
      'graphic design', 'graphic designer', 'designer',
      'logo', 'logos', 'logotype', 'branding', 'brand', 'identity',
      'advertising', 'flyer', 'flyers', 'poster', 'posters',
      'banner', 'banners', 'business card', 'business cards',
      'web design', 'website', 'corporate image',
      'illustration', 'illustrator', 'infographic',
      // Contextual phrases
      'create logo', 'design logo', 'need logo',
      'design business cards', 'design advertising', 'company branding'
    ]
  },
  'Asesoría legal': {
    es: [
      'legal', 'abogado', 'abogada', 'licenciado', 'derecho',
      'asesoria legal', 'asesor legal', 'juridico', 'juridica',
      'demanda', 'juicio', 'contrato', 'contratos',
      'tramite', 'tramites', 'documento', 'documentos', 'notario',
      'divorcio', 'divorcios', 'herencia', 'herencias', 'testamento',
      'laboral', 'penal', 'civil', 'mercantil', 'fiscal',
      // Frases contextuales
      'consulta legal', 'necesito abogado', 'problema legal',
      'asesor juridico', 'redactar contrato', 'firma legal'
    ],
    en: [
      'legal', 'lawyer', 'attorney', 'law', 'counsel',
      'legal advice', 'legal advisor', 'juridical',
      'lawsuit', 'trial', 'contract', 'contracts',
      'paperwork', 'document', 'documents', 'notary',
      'divorce', 'inheritance', 'will', 'estate',
      'labor', 'criminal', 'civil', 'commercial', 'tax',
      // Contextual phrases
      'legal consultation', 'need lawyer', 'legal problem',
      'legal counsel', 'draft contract', 'legal review'
    ]
  },
  'Contabilidad': {
    es: [
      'contabilidad', 'contador', 'contadora', 'contable',
      'impuesto', 'impuestos', 'declaracion', 'declaraciones',
      'fiscal', 'financiero', 'finanzas', 'empresa', 'negocio',
      'sat', 'facturacion', 'factura', 'facturas',
      'nomina', 'nominas', 'auditoria',
      'estados financieros', 'balance', 'iva', 'isr',
      // Frases contextuales
      'calculo impuestos', 'declaracion anual', 'necesito contador',
      'llevar contabilidad', 'asesor fiscal', 'pagar impuestos'
    ],
    en: [
      'accounting', 'accountant', 'bookkeeping', 'bookkeeper',
      'tax', 'taxes', 'tax return', 'filing',
      'fiscal', 'financial', 'finance', 'business',
      'invoice', 'invoicing', 'billing',
      'payroll', 'audit', 'auditing',
      'financial statements', 'balance sheet', 'vat',
      // Contextual phrases
      'tax calculation', 'annual filing', 'need accountant',
      'manage books', 'tax advisor', 'pay taxes'
    ]
  },
  'Marketing digital': {
    es: [
      'marketing', 'marketing digital', 'mercadotecnia',
      'publicidad', 'anuncios', 'anuncio', 'campana', 'campanas',
      'redes sociales', 'facebook', 'instagram', 'tiktok', 'youtube',
      'social media', 'community manager',
      'seo', 'posicionamiento', 'google', 'ads', 'adwords',
      'estrategia', 'contenido', 'viral', 'seguidores',
      'email marketing', 'newsletter', 'blog',
      // Frases contextuales
      'posicionar web', 'mas seguidores', 'vender online',
      'publicidad internet', 'crear campana', 'manejo redes'
    ],
    en: [
      'marketing', 'digital marketing', 'online marketing',
      'advertising', 'ads', 'ad', 'campaign', 'campaigns',
      'social media', 'facebook', 'instagram', 'tiktok', 'youtube',
      'community manager', 'social manager',
      'seo', 'search engine', 'google', 'ppc',
      'strategy', 'content', 'viral', 'followers',
      'email marketing', 'newsletter', 'blog', 'blogging',
      // Contextual phrases
      'rank website', 'more followers', 'sell online',
      'online advertising', 'create campaign', 'manage social media'
    ]
  },
  'Traducción': {
    es: [
      'traduccion', 'traductor', 'traductora', 'traducir',
      'idioma', 'idiomas', 'interpretacion', 'interprete',
      'ingles', 'frances', 'aleman', 'chino', 'japones', 'portugues', 'italiano',
      'certificada', 'jurada', 'simultanea', 'consecutiva',
      'documento', 'documentos', 'subtitulos', 'localizacion',
      // Frases contextuales
      'traducir documento', 'necesito traductor', 'traducir pagina',
      'traduccion oficial', 'certificar traduccion'
    ],
    en: [
      'translation', 'translator', 'translate', 'interpreting', 'interpreter',
      'language', 'languages', 'bilingual', 'multilingual',
      'english', 'french', 'german', 'chinese', 'japanese', 'portuguese', 'italian',
      'certified', 'sworn', 'simultaneous', 'consecutive',
      'document', 'documents', 'subtitles', 'localization',
      // Contextual phrases
      'translate document', 'need translator', 'translate website',
      'official translation', 'certify translation'
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
