// models/User/Admin.js
import mongoose from 'mongoose';
import User from './User.js';

// Admin discriminator. Keep it minimal for now.
const adminSchema = new mongoose.Schema({
  // Reserved for future admin-specific fields
  permissions: {
    type: [String],
    default: []
  }
});

const Admin = User.discriminator('Admin', adminSchema);
export default Admin;
