// Errores con código HTTP: las rutas los traducen a la respuesta correcta en lugar de un 500 genérico.

export class ErrorApp extends Error {
  constructor(mensaje, status = 500) {
    super(mensaje);
    this.name = 'ErrorApp';
    this.status = status;
  }
}

// La entrada no es válida (400).
export class ErrorValidacion extends ErrorApp {
  constructor(mensaje) { super(mensaje, 400); this.name = 'ErrorValidacion'; }
}

// El registro ya no existe (404).
export class ErrorNoEncontrado extends ErrorApp {
  constructor(mensaje) { super(mensaje, 404); this.name = 'ErrorNoEncontrado'; }
}

// La planilla cambió mientras se operaba, o la referencia es ambigua: no se tocó nada (409).
export class ErrorConflicto extends ErrorApp {
  constructor(mensaje) { super(mensaje, 409); this.name = 'ErrorConflicto'; }
}

export function statusDe(e) {
  return e && Number.isInteger(e.status) ? e.status : 500;
}
