export function normalizeInviteCode(value) {
  if (typeof value !== 'string' || value.length > 32) throw new Error('Enter an 8-character invitation code.');
  const code = value.replace(/[\s-]/g, '').toUpperCase();
  if (!/^[A-HJ-NP-Z2-9]{8}$/.test(code)) throw new Error('Enter an 8-character invitation code, such as ABCD-2345.');
  return code;
}
export function formatInviteCode(value) { return `${value.slice(0,4)}-${value.slice(4)}`; }
