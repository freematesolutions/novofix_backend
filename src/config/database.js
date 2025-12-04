import mongoose from 'mongoose';
import { config } from 'dotenv';

config();

const connectDB = async () => {
  try {
    if (!process.env.MONGODB_URI) {
      throw new Error('MONGODB_URI is not defined in environment variables');
    }

  const conn = await mongoose.connect(process.env.MONGODB_URI);

    console.log(`✅ MongoDB Connected: ${conn.connection.host}`);
    console.log(`📊 Database: ${conn.connection.name}`);
    console.log(`👥 Connections: ${mongoose.connections.length}`);

    // Arreglo de índices geoespaciales heredados (si existieran)
    try {
      // Users collection maintenance (providers)
      const users = mongoose.connection.collection('users');
      const uIdx = await users.indexes();
      for (const idx of uIdx) {
        const hasLegacyGeo = idx?.key && Object.keys(idx.key).some(k => k.includes('providerProfile.serviceArea.coordinates'));
        if (hasLegacyGeo) {
          try {
            await users.dropIndex(idx.name);
            console.log(`🧹 Dropped legacy geo index (users): ${idx.name}`);
          } catch (e) {
            console.warn('Could not drop legacy geo index (users):', idx.name, e?.message);
          }
        }
      }
      try {
        await users.createIndex({ 'providerProfile.serviceArea.location': '2dsphere' });
        console.log('🧭 Ensured 2dsphere index on users.providerProfile.serviceArea.location');
      } catch (e) {
        console.warn('Ensure 2dsphere index (users) warning:', e?.message);
      }

      // ServiceRequests collection maintenance (client requests)
      const requests = mongoose.connection.collection('servicerequests');
      const rIdx = await requests.indexes();
      for (const idx of rIdx) {
        const hasLegacyGeo = idx?.key && Object.keys(idx.key).some(k => k === 'location.coordinates');
        if (hasLegacyGeo) {
          try {
            await requests.dropIndex(idx.name);
            console.log(`🧹 Dropped legacy geo index (servicerequests): ${idx.name}`);
          } catch (e) {
            console.warn('Could not drop legacy geo index (servicerequests):', idx.name, e?.message);
          }
        }
      }
      try {
        await requests.createIndex({ 'location.location': '2dsphere' });
        console.log('🧭 Ensured 2dsphere index on servicerequests.location.location');
      } catch (e) {
        console.warn('Ensure 2dsphere index (servicerequests) warning:', e?.message);
      }
    } catch (e) {
      console.warn('Geo index maintenance skipped:', e?.message);
    }

    // Manejar eventos de conexión
    mongoose.connection.on('connected', () => {
      console.log('🟢 Mongoose connected to DB');
    });

    mongoose.connection.on('error', (err) => {
      console.error('🔴 Mongoose connection error:', err);
    });

    mongoose.connection.on('disconnected', () => {
      console.log('🟡 Mongoose disconnected from DB');
    });

    // Manejar cierre graceful de la aplicación
    process.on('SIGINT', async () => {
      await mongoose.connection.close();
      console.log('Mongoose connection closed through app termination');
      process.exit(0);
    });

  } catch (error) {
    console.error('❌ Database connection failed:', error.message);
    console.error('Please check your MONGODB_URI in .env file');
    process.exit(1);
  }
};

export default connectDB;