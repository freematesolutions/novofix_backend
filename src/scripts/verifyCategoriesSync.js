#!/usr/bin/env node

/**
 * Script de verificación de sincronización de categorías
 * Verifica que las categorías estén sincronizadas entre frontend y backend
 */

import { readFile } from 'fs/promises';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

const COLORS = {
  reset: '\x1b[0m',
  red: '\x1b[31m',
  green: '\x1b[32m',
  yellow: '\x1b[33m',
  blue: '\x1b[34m',
  cyan: '\x1b[36m'
};

function log(message, color = 'reset') {
  console.log(`${COLORS[color]}${message}${COLORS.reset}`);
}

async function extractCategories(filePath) {
  try {
    const content = await readFile(filePath, 'utf-8');
    
    // Buscar el array SERVICE_CATEGORIES
    const match = content.match(/export const SERVICE_CATEGORIES\s*=\s*\[([\s\S]*?)\];/);
    
    if (!match) {
      throw new Error(`No se encontró SERVICE_CATEGORIES en ${filePath}`);
    }
    
    // Extraer y limpiar las categorías
    const categoriesText = match[1];
    const categories = categoriesText
      .split(',')
      .map(line => line.trim())
      .filter(line => line.startsWith("'") || line.startsWith('"'))
      .map(line => line.replace(/^['"]|['"]$/g, ''))
      .filter(Boolean);
    
    return categories;
  } catch (error) {
    throw new Error(`Error leyendo ${filePath}: ${error.message}`);
  }
}

async function verifySync() {
  log('\n🔍 Verificando sincronización de categorías...\n', 'cyan');
  
  // Desde server/src/scripts hacia client/src/utils y server/src/config
  const frontendPath = join(__dirname, '..', '..', '..', 'client', 'src', 'utils', 'categories.js');
  const backendPath = join(__dirname, '..', 'config', 'categories.js');
  
  try {
    // Extraer categorías
    log('📂 Leyendo archivos...', 'blue');
    const frontendCategories = await extractCategories(frontendPath);
    const backendCategories = await extractCategories(backendPath);
    
    log(`   Frontend: ${frontendCategories.length} categorías`, 'blue');
    log(`   Backend:  ${backendCategories.length} categorías\n`, 'blue');
    
    // Verificar longitud
    if (frontendCategories.length !== backendCategories.length) {
      log('❌ FALLO: Número diferente de categorías', 'red');
      log(`   Frontend: ${frontendCategories.length}`, 'yellow');
      log(`   Backend:  ${backendCategories.length}\n`, 'yellow');
      process.exit(1);
    }
    
    // Verificar contenido
    const differences = [];
    const frontendSet = new Set(frontendCategories);
    const backendSet = new Set(backendCategories);
    
    // Categorías en frontend pero no en backend
    for (const cat of frontendCategories) {
      if (!backendSet.has(cat)) {
        differences.push({ type: 'missing_backend', category: cat });
      }
    }
    
    // Categorías en backend pero no en frontend
    for (const cat of backendCategories) {
      if (!frontendSet.has(cat)) {
        differences.push({ type: 'missing_frontend', category: cat });
      }
    }
    
    // Verificar orden
    let orderMismatch = false;
    for (let i = 0; i < frontendCategories.length; i++) {
      if (frontendCategories[i] !== backendCategories[i]) {
        orderMismatch = true;
        break;
      }
    }
    
    // Reportar resultados
    if (differences.length === 0 && !orderMismatch) {
      log('✅ ÉXITO: Categorías sincronizadas correctamente', 'green');
      log(`   Total: ${frontendCategories.length} categorías`, 'green');
      log('\n📋 Categorías verificadas:', 'cyan');
      frontendCategories.forEach((cat, idx) => {
        log(`   ${idx + 1}. ${cat}`, 'blue');
      });
      log('');
      process.exit(0);
    }
    
    // Reportar diferencias
    log('❌ FALLO: Categorías no sincronizadas\n', 'red');
    
    if (differences.length > 0) {
      log('🔴 Diferencias encontradas:', 'red');
      differences.forEach(diff => {
        if (diff.type === 'missing_backend') {
          log(`   - "${diff.category}" está en frontend pero NO en backend`, 'yellow');
        } else {
          log(`   - "${diff.category}" está en backend pero NO en frontend`, 'yellow');
        }
      });
      log('');
    }
    
    if (orderMismatch) {
      log('🔴 El orden de las categorías no coincide:', 'red');
      log('\n   Frontend:', 'yellow');
      frontendCategories.slice(0, 5).forEach((cat, idx) => {
        log(`   ${idx + 1}. ${cat}`, 'yellow');
      });
      log('   ...\n', 'yellow');
      
      log('   Backend:', 'yellow');
      backendCategories.slice(0, 5).forEach((cat, idx) => {
        log(`   ${idx + 1}. ${cat}`, 'yellow');
      });
      log('   ...\n', 'yellow');
    }
    
    process.exit(1);
    
  } catch (error) {
    log(`\n❌ ERROR: ${error.message}\n`, 'red');
    process.exit(1);
  }
}

// Ejecutar verificación
verifySync();
