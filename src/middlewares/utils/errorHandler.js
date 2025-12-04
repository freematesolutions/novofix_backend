const errorHandler = (err, req, res, next) => {
  let error = { ...err };
  error.message = err.message;

  // Log error for development
  if (process.env.NODE_ENV === 'development') {
    console.error('🔴 Error Stack:', err.stack);
    console.error('🔴 Error Details:', {
      name: err.name,
      message: err.message,
      code: err.code,
      keyValue: err.keyValue,
      errors: err.errors
    });
  }

  // Mongoose bad ObjectId
  if (err.name === 'CastError') {
    const message = `Resource not found with id of ${err.value}`;
    error = { 
      message, 
      statusCode: 404,
      isOperational: true 
    };
  }

  // Mongoose duplicate key
  if (err.code === 11000) {
    const field = Object.keys(err.keyValue)[0];
    const value = err.keyValue[field];
    const message = `Duplicate field value: ${field} '${value}' already exists`;
    error = { 
      message, 
      statusCode: 400,
      isOperational: true 
    };
  }

  // Mongoose validation error
  if (err.name === 'ValidationError') {
    const errors = Object.values(err.errors).map(val => val.message);
    const message = `Invalid input data: ${errors.join('. ')}`;
    error = { 
      message, 
      statusCode: 400,
      errors: errors,
      isOperational: true 
    };
  }

  // JWT errors
  if (err.name === 'JsonWebTokenError') {
    const message = 'Invalid token. Please log in again.';
    error = { 
      message, 
      statusCode: 401,
      isOperational: true 
    };
  }

  if (err.name === 'TokenExpiredError') {
    const message = 'Your token has expired. Please log in again.';
    error = { 
      message, 
      statusCode: 401,
      isOperational: true 
    };
  }

  // Multer errors (file upload)
  if (err.name === 'MulterError') {
    let message = 'File upload error';
    if (err.code === 'LIMIT_FILE_SIZE') {
      message = 'File too large';
    } else if (err.code === 'LIMIT_FILE_COUNT') {
      message = 'Too many files';
    } else if (err.code === 'LIMIT_UNEXPECTED_FILE') {
      message = 'Unexpected field';
    }
    
    error = { 
      message, 
      statusCode: 400,
      isOperational: true 
    };
  }

  // Rate limit error
  if (err.statusCode === 429) {
    error = {
      message: 'Too many requests from this IP, please try again later.',
      statusCode: 429,
      isOperational: true
    };
  }

  // Default error
  res.status(error.statusCode || 500).json({
    success: false,
    message: error.message || 'Internal Server Error',
    ...(process.env.NODE_ENV === 'development' && {
      error: err,
      stack: err.stack
    }),
    ...(error.errors && { errors: error.errors })
  });
};

export default errorHandler;