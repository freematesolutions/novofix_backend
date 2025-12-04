import jwt from 'jsonwebtoken';
import { AuthenticationError } from '../utils/errors.js';
import User from '../../models/User/User.js';

export const socketAuth = async (socket, next) => {
  try {
    const token = socket.handshake.auth.token;
    
    if (!token) {
      throw new AuthenticationError('No token provided');
    }

    // Verificar token JWT
    const decoded = jwt.verify(token, process.env.JWT_SECRET);
    const user = await User.findById(decoded.id).select('-password');
    
    if (!user) {
      throw new AuthenticationError('User not found');
    }

    if (!user.isActive) {
      throw new AuthenticationError('User account is inactive');
    }

    // Adjuntar datos de usuario al socket
    socket.userId = user._id.toString();
    socket.userRole = user.role;
    socket.userData = {
      id: user._id,
      email: user.email,
      role: user.role,
      name: user.profile?.firstName || user.providerProfile?.businessName
    };

    next();
  } catch (error) {
    console.error('Socket authentication error:', error.message);
    next(new AuthenticationError(error.message));
  }
};