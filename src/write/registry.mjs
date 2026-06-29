// src/write/registry.mjs — mapa id -> WriteAction. Cada ação se registra; o engine só consulta.
export const WRITE_ACTIONS = {};

export function registerAction(a) {
  WRITE_ACTIONS[a.id] = a;
  return a;
}

export function getAction(id) {
  return WRITE_ACTIONS[id];
}
