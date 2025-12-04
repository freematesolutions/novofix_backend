export class SocketError extends Error {
  constructor(code, message) {
    super(message);
    this.code = code;
  }
}

export class ValidationError extends SocketError {
  constructor(message) {
    super('VALIDATION_ERROR', message);
  }
}

export class AuthenticationError extends SocketError {
  constructor(message) {
    super('AUTHENTICATION_ERROR', message);
  }
}

export class RoomError extends SocketError {
  constructor(message) {
    super('ROOM_ERROR', message);
  }
}