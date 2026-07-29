/**
 * Password policy. Kept free of node: imports so client components can render the
 * rules without dragging node:crypto into the browser bundle.
 */

export const MIN_PASSWORD_LENGTH = 10;
export const MAX_PASSWORD_LENGTH = 1024;

/**
 * Length is the only rule. Composition requirements ("one uppercase, one symbol")
 * reliably produce `Password1!` and nothing more, while a length floor actually
 * raises the search space.
 */
export function validatePassword(password: string): string | null {
  if (password.length < MIN_PASSWORD_LENGTH) {
    return `Password must be at least ${MIN_PASSWORD_LENGTH} characters`;
  }
  if (password.length > MAX_PASSWORD_LENGTH) return "Password is too long";
  return null;
}
