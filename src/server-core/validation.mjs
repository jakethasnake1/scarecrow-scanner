// Minimal Base58 validation: no wallet SDK, keypair, signing, or browser permissions.
const ALPHABET = '123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz';
const ALPHABET_MAP = new Map([...ALPHABET].map((char, index) => [char, BigInt(index)]));

export function isSolanaAddress(value) {
  if (typeof value !== 'string' || value.length < 32 || value.length > 44) return false;
  let number = 0n;
  for (const char of value) {
    const digit = ALPHABET_MAP.get(char);
    if (digit === undefined) return false;
    number = number * 58n + digit;
  }
  let bytes = 0;
  while (number > 0n) { bytes++; number >>= 8n; }
  for (const char of value) {
    if (char !== '1') break;
    bytes++;
  }
  return bytes === 32;
}

export function cleanText(value, maxLength = 1200) {
  if (typeof value !== 'string') return '';
  return value.trim().replace(/[\u0000-\u001f\u007f]/g, ' ').slice(0, maxLength);
}

export function validEvidenceUrl(value) {
  if (!value) return true;
  if (typeof value !== 'string' || value.length > 600) return false;
  try {
    const url = new URL(value);
    return url.protocol === 'https:' && !!url.hostname && !url.username && !url.password;
  } catch { return false; }
}

export function toPublicUrl(value) {
  return validEvidenceUrl(value) && value ? value : null;
}
