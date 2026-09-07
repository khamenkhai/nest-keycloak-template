export function getMyanmarShortCode(text: string): string {
  return text
    .normalize('NFD')
    .replace(/[\u1000-\u102A]\u103A/gu, '') // remove Myanmar final consonants
    .replace(/\p{M}/gu, '') // remove Myanmar vowel marks
    .replace(/[A-Za-z]+/g, (word) => word[0]) // English word → initial
    .replace(/\s+/g, ''); // remove spaces
}
