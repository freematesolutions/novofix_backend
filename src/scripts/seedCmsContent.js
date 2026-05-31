// scripts/seedCmsContent.js
//
// Crea los registros iniciales del CMS para cada `key` editable.
// El frontend usa los textos i18n existentes como fallback hasta que el
// admin publique contenido propio desde el panel; este seed sólo garantiza
// que existan documentos en Mongo para que el panel los liste.
//
// Uso:
//   node src/scripts/seedCmsContent.js
//   npm run seed:cms   (si lo agregás a package.json)

import 'dotenv/config';
import mongoose from 'mongoose';
import CmsContent, { CMS_CONTENT_KEYS } from '../models/Content/CmsContent.js';
import FaqItem from '../models/Content/FaqItem.js';
import { renderMarkdownSafe } from '../services/internal/cmsService.js';

const DEFAULTS = {
  terms: {
    es: {
      title: 'Términos y Condiciones',
      sections: [{
        id: 'intro',
        label: 'Introducción',
        bodyMarkdown:
          '_Este contenido aún no fue editado en el panel. Se está mostrando el texto por defecto definido en la traducción._\n\n' +
          'Editá esta página desde **Admin → Contenidos → Términos y Condiciones**.'
      }]
    },
    en: {
      title: 'Terms and Conditions',
      sections: [{
        id: 'intro',
        label: 'Introduction',
        bodyMarkdown:
          '_This content has not yet been edited in the panel. The default translation text is shown._\n\n' +
          'Edit this page from **Admin → Contents → Terms and Conditions**.'
      }]
    }
  },
  privacy: {
    es: {
      title: 'Política de Privacidad',
      sections: [{ id: 'intro', label: 'Introducción', bodyMarkdown: 'Editá esta página desde **Admin → Contenidos → Política de Privacidad**.' }]
    },
    en: {
      title: 'Privacy Policy',
      sections: [{ id: 'intro', label: 'Introduction', bodyMarkdown: 'Edit this page from **Admin → Contents → Privacy Policy**.' }]
    }
  },
  about: {
    es: {
      title: 'Sobre Nosotros',
      sections: [{ id: 'intro', label: 'Quiénes somos', bodyMarkdown: 'Editá esta página desde **Admin → Contenidos → Sobre Nosotros**.' }]
    },
    en: {
      title: 'About Us',
      sections: [{ id: 'intro', label: 'Who we are', bodyMarkdown: 'Edit this page from **Admin → Contents → About Us**.' }]
    }
  },
  hero: {
    es: {
      title: 'Encontrá el profesional ideal para tu hogar',
      sections: [{ id: 'subtitle', label: 'Subtítulo', bodyMarkdown: 'Conectamos clientes con técnicos verificados.' }]
    },
    en: {
      title: 'Find the perfect professional for your home',
      sections: [{ id: 'subtitle', label: 'Subtitle', bodyMarkdown: 'We connect clients with verified technicians.' }]
    }
  },
  contact: {
    es: {
      title: 'Contacto',
      sections: [{ id: 'email', label: 'Email', bodyMarkdown: 'soporte@novofixpro.com' }]
    },
    en: {
      title: 'Contact',
      sections: [{ id: 'email', label: 'Email', bodyMarkdown: 'soporte@novofixpro.com' }]
    }
  }
};

const DEFAULT_FAQ = [
  {
    category: 'general',
    order: 10,
    question: { es: '¿Qué es NovoFix?', en: 'What is NovoFix?' },
    answerMarkdown: {
      es: 'NovoFix es una plataforma que conecta clientes con **profesionales verificados** del rubro hogar y servicios.',
      en: 'NovoFix is a platform that connects customers with **verified professionals** in home and service trades.'
    }
  },
  {
    category: 'client',
    order: 10,
    question: { es: '¿Cómo publico una solicitud?', en: 'How do I post a request?' },
    answerMarkdown: {
      es: 'Iniciá sesión como cliente y desde tu panel hacé clic en *Nueva solicitud*. Completá los datos y enviala.',
      en: 'Sign in as a client and from your dashboard click *New request*. Fill in the details and submit.'
    }
  },
  {
    category: 'provider',
    order: 10,
    question: { es: '¿Cómo me registro como profesional?', en: 'How do I register as a professional?' },
    answerMarkdown: {
      es: 'Desde la página principal elegí **Soy profesional** y completá el onboarding.',
      en: 'From the home page choose **I am a professional** and complete the onboarding.'
    }
  }
];

async function seed() {
  const uri = process.env.MONGODB_URI || process.env.MONGO_URI;
  if (!uri) {
    console.error('❌ Falta MONGODB_URI en el entorno.');
    process.exit(1);
  }

  await mongoose.connect(uri);
  console.log('✅ Conectado a MongoDB');

  // Contenidos
  let created = 0;
  let skipped = 0;
  for (const key of CMS_CONTENT_KEYS) {
    const exists = await CmsContent.findOne({ key }).lean();
    if (exists) {
      skipped++;
      console.log(`⏭️  ${key}: ya existe, no se sobreescribe`);
      continue;
    }
    const data = DEFAULTS[key];
    const buildLocale = (loc) => ({
      title: loc.title,
      sections: loc.sections.map((s) => ({
        id: s.id,
        label: s.label,
        bodyMarkdown: s.bodyMarkdown,
        bodyHtml: renderMarkdownSafe(s.bodyMarkdown)
      })),
      lastEditedAt: new Date()
    });

    await CmsContent.create({
      key,
      translations: { es: buildLocale(data.es), en: buildLocale(data.en) },
      version: 1,
      publishedAt: new Date()
    });
    created++;
    console.log(`✅ ${key}: creado`);
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
