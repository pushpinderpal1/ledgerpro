/**
 * Password complexity rules. Tuned to balance accountability with usability:
 *  - 12 characters minimum (NIST-recommended floor for non-MFA accounts)
 *  - At least 3 of: lowercase, uppercase, digit, symbol
 *  - Rejects the 50 most common breached passwords
 */

const COMMON = new Set([
  '123456','password','12345678','qwerty','123456789','12345','1234','111111',
  '1234567','dragon','123123','baseball','abc123','football','monkey','letmein',
  'shadow','master','666666','qwertyuiop','123321','mustang','1234567890',
  'michael','654321','superman','1qaz2wsx','7777777','121212','000000','qazwsx',
  '123qwe','killer','trustno1','jordan','jennifer','zxcvbnm','asdfgh','hunter',
  'buster','soccer','harley','batman','andrew','tigger','sunshine','iloveyou',
  '2000','charlie','robert','thomas','hockey','ranger','daniel','starwars',
  'klaster','112233','george','computer','michelle','jessica','pepper','1111',
  'zxcvbn','555555','11111111','131313','freedom','777777','pass','maggie',
  'admin','administrator','welcome','password1','password123','letmein123',
])

export interface PasswordCheck {
  ok: boolean
  reasons: string[]
}

export function checkPasswordStrength(pw: string): PasswordCheck {
  const reasons: string[] = []
  if (typeof pw !== 'string') return { ok: false, reasons: ['Password required'] }

  if (pw.length < 12) reasons.push('Must be at least 12 characters')
  if (pw.length > 128) reasons.push('Must be 128 characters or fewer')

  let classes = 0
  if (/[a-z]/.test(pw)) classes++
  if (/[A-Z]/.test(pw)) classes++
  if (/[0-9]/.test(pw)) classes++
  if (/[^A-Za-z0-9]/.test(pw)) classes++
  if (classes < 3) reasons.push('Must include at least 3 of: lowercase, uppercase, digit, symbol')

  if (COMMON.has(pw.toLowerCase())) reasons.push('Password is too common')

  // Reject passwords built around a known weak password (e.g. "Password123!").
  // Substring match against the same blacklist, lowercased.
  const lower = pw.toLowerCase()
  for (const w of COMMON) {
    if (w.length >= 6 && lower.includes(w)) {
      reasons.push('Contains a known weak password')
      break
    }
  }

  // Reject simple repeats / sequences.
  if (/^(.)\1+$/.test(pw)) reasons.push('Cannot be a single repeated character')

  return { ok: reasons.length === 0, reasons }
}
