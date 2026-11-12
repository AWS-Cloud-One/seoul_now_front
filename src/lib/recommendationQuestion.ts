export function recommendationQuestion(name: string) {
  const label = name.trim().normalize('NFC')
  const last = label.charCodeAt(label.length - 1)
  if (last >= 0xac00 && last <= 0xd7a3)
    return `${label}${(last - 0xac00) % 28 === 0 ? '는' : '은'} 왜 추천했어?`
  // Avoid guessing the pronunciation of names ending in Latin letters or numbers.
  return `${label} 추천 이유를 알려줘`
}
