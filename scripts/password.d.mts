export function validarPassword(password: string): string | null;
export function hashPassword(password: string): string;
export function verifyPassword(password: string, almacenado: string | null | undefined): boolean;
export const HASH_FICTICIO: string;
