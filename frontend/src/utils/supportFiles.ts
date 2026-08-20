export const SUPPORT_FILE_ACCEPT = [
  '.jpg',
  '.jpeg',
  '.png',
  '.webp',
  '.pdf',
  '.doc',
  '.docx',
  'image/jpeg',
  'image/png',
  'image/webp',
  'application/pdf',
  'application/msword',
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
].join(',')

export const MAX_SUPPORT_FILE_SIZE = 5 * 1024 * 1024

const ALLOWED_EXTENSIONS = new Set(['jpg', 'jpeg', 'png', 'webp', 'pdf', 'doc', 'docx'])

function extension(value: string) {
  const normalized = value.replace(/\.enc$/i, '')
  return normalized.includes('.') ? normalized.split('.').pop()?.toLowerCase() ?? '' : ''
}
export function validateSupportFile(file: File): string | null {
  const ext = extension(file.name)
  if (!ALLOWED_EXTENSIONS.has(ext)) {
    return 'Недопустимый формат. Разрешены JPG, PNG, WEBP, PDF, DOC и DOCX.'
  }
  if (file.size > MAX_SUPPORT_FILE_SIZE) {
    return `Файл слишком большой (${(file.size / 1024 / 1024).toFixed(1)} МБ). Максимум — 5 МБ.`
  }
  return null
}

export function supportAttachmentKind(path?: string | null): 'image' | 'pdf' | 'word' | 'unknown' {
  const ext = extension(path ?? '')
  if (['jpg', 'jpeg', 'png', 'webp'].includes(ext)) return 'image'
  if (ext === 'pdf') return 'pdf'
  if (ext === 'doc' || ext === 'docx') return 'word'
  return 'unknown'
}
