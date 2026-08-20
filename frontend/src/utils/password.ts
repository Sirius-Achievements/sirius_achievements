export interface PasswordRequirement {
  id: 'length' | 'upper' | 'lower' | 'number' | 'special'
  label: string
  met: boolean
}
export function getPasswordRequirements(password: string): PasswordRequirement[] {
  return [
    { id: 'length', label: 'Не менее 8 символов', met: password.length >= 8 },
    { id: 'upper', label: 'Заглавная буква', met: /[A-ZА-ЯЁ]/.test(password) },
    { id: 'lower', label: 'Строчная буква', met: /[a-zа-яё]/.test(password) },
    { id: 'number', label: 'Цифра', met: /[0-9]/.test(password) },
    { id: 'special', label: 'Специальный символ', met: /[^\p{L}\p{N}\s]/u.test(password) },
  ]
}

export function isPasswordStrong(password: string) {
  return getPasswordRequirements(password).every((requirement) => requirement.met)
}
