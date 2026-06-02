// server/src/scripts/backfillCompletedJobs.js
//
// Script de migraci\u00f3n: recalcula `providerProfile.stats.completedJobs` para
// todos los proveedores agregando los bookings reales en estado 'completed'.
//
// Antes del Requerimiento 6 el contador nunca se incrementaba, por lo que
// los proveedores con contrataciones reales mostraban siempre 0 en las
// tarjetas. Este script normaliza el estado existente.
//
// Uso (desde la ra\u00edz del backend):
//   node src/scripts/backfillCompletedJobs.js
//
// Idempotente: puede ejecutarse cuantas veces sea necesario.

import mongoose from 'mongoose';
import dotenv from 'dotenv';
import Booking from '../models/Service/Booking.js';
import Provider from '../models/User/Provider.js';

dotenv.config();

const MONGO_URI = process.env.MONGO_URI || process.env.MONGODB_URI;
if (!MONGO_URI) {
  console.error('\u274c MONGO_URI no definido en variables de entorno');
  process.exit(1);
}

async function run() {
  console.log('\ud83d\udd17 Conectando a MongoDB...');
  await mongoose.connect(MONGO_URI);
  console.log('\u2705 Conectado.');

  console.log('\ud83d\udcca Agregando bookings completados por proveedor...');
  const aggregation = await Booking.aggregate([
    { $match: { status: 'completed' } },
    { $group: { _id: '$provider', count: { $sum: 1 } } }
  ]);

  console.log(`\ud83d\udd0d ${aggregation.length} proveedores con bookings completados encontrados.`);

  let updated = 0;
  let unchanged = 0;
  for (const row of aggregation) {
    const providerId = row._id;
    const realCount = row.count;
    const result = await Provider.updateOne(
      { _id: providerId },
      { $set: { 'providerProfile.stats.completedJobs': realCount } }
    );
    if (result.modifiedCount > 0) {
      updated += 1;
      console.log(`  \u2713 Provider ${providerId}: stats.completedJobs = ${realCount}`);
    } else {
      unchanged += 1;
    }
  }

  // Proveedores sin bookings pero con contador > 0 (datos sucios): poner a 0
  const reset = await Provider.updateMany(
    {
      _id: { $nin: aggregation.map((r) => r._id) },
      'providerProfile.stats.completedJobs': { $gt: 0 }
    },
    { $set: { 'providerProfile.stats.completedJobs': 0 } }
  );

  console.log('\u2728 Backfill finalizado:');
  console.log(`   Actualizados: ${updated}`);
  console.log(`   Sin cambios:  ${unchanged}`);
  console.log(`   Reseteados a 0: ${reset.modifiedCount}`);

  await mongoose.disconnect();
  console.log('\ud83d\udc4b Desconectado.');
}

run().catch((err) => {
  console.error('\u274c Error en backfill:', err);
  process.exit(1);
});
