export function normalizeInviteCode(value) {
  if (typeof value !== 'string' || value.length > 16) throw new Error('Enter a 4-digit invitation code.');
  const code = value.trim();
  if (!/^[0-9]{4}$/.test(code)) throw new Error('Enter a 4-digit invitation code, such as 0047.');
  return code;
}
export function formatInviteCode(value) { return value; }
