// scripts/seedCmsContent.js
//
// Siembra los registros iniciales del CMS para cada `key` editable usando
// los DEFAULTS canónicos de `services/internal/cmsDefaults.js` (mismos textos
// que viven en `client/src/locales/{es,en}/translation.json`).
//
// Si el documento ya existe NO se sobreescribe — para reimportar desde
// defaults usar el endpoint admin `POST /admin/cms/contents/:key/reset-from-defaults`
// o el botón "Reimportar plantilla" del panel.
//
// Uso:
//   node src/scripts/seedCmsContent.js
//   npm run seed:cms

import 'dotenv/config';
import mongoose from 'mongoose';
import CmsContent, { CMS_CONTENT_KEYS } from '../models/Content/CmsContent.js';
import FaqItem from '../models/Content/FaqItem.js';
import { renderMarkdownSafe } from '../services/internal/cmsService.js';
import { buildDefaultTranslations, buildDefaultFaqItems } from '../services/internal/cmsDefaults.js';

// Los defaults de FAQ son los MISMOS textos que se ven en la Home (sección
// FAQ + JSON-LD). Vivían en `seo.home.faq` del i18n y ahora se persisten en
// `FaqItem` para que el admin pueda editarlos sin redeploy.
const DEFAULT_FAQ = buildDefaultFaqItems();

async function seed() {
  const uri = process.env.MONGODB_URI || process.env.MONGO_URI;
  if (!uri) {
    console.error('❌ Falta MONGODB_URI en el entorno.');
    process.exit(1);
  }

  await mongoose.connect(uri);
  console.log('✅ Conectado a MongoDB');

  // Contenidos editoriales (terms / privacy / about / hero / contact)
  let created = 0;
  let skipped = 0;
  for (const key of CMS_CONTENT_KEYS) {
    const exists = await CmsContent.findOne({ key }).lean();
    if (exists) {
      skipped++;
      console.log(`⏭️  ${key}: ya existe, se conserva. (Usar reset-from-defaults para reimportar.)`);
      continue;
    }
    const translations = buildDefaultTranslations(key);
    await CmsContent.create({
      key,
      translations: {
        es: { ...translations.es, lastEditedAt: new Date() },
        en: { ...translations.en, lastEditedAt: new Date() }
      },
      version: 1,
      publishedAt: new Date()
    });
    created++;
    console.log(`✅ ${key}: creado con ${translations.es.sections.length} secciones ES y ${translations.en.sections.length} EN`);
  }

  // FAQ
  const faqCount = await FaqItem.estimatedDocumentCount();
  let faqCreated = 0;
  if (faqCount === 0) {
    for (const item of DEFAULT_FAQ) {
      await FaqItem.create({
        category: item.category,
        order: item.order,
        question: item.question,
        answerMarkdown: item.answerMarkdown,
        answerHtml: {
          es: renderMarkdownSafe(item.answerMarkdown.es),
          en: renderMarkdownSafe(item.answerMarkdown.en)
        },
        active: true
      });
      faqCreated++;
    }
    console.log(`✅ FAQ: ${faqCreated} ítems creados`);
  } else {
    console.log(`⏭️  FAQ: ${faqCount} ítems ya existen, no se inserta`);
  }

  console.log(`\nResumen: ${created} contenidos creados, ${skipped} saltados, ${faqCreated} FAQ creadas.`);
  await mongoose.disconnect();
  process.exit(0);
}

seed().catch((err) => {
  console.error('❌ Error en seed CMS:', err);
  process.exit(1);
});
