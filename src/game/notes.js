export function createEmptyNotes() {
  return Array(81).fill(0);
}

export function noteMaskForDigit(digit) {
  if (!Number.isInteger(digit) || digit < 1 || digit > 9) {
    return 0;
  }

  return 1 << (digit - 1);
}

export function hasNote(mask, digit) {
  return Boolean(mask & noteMaskForDigit(digit));
}

export function getNoteDigits(mask) {
  return Array.from({ length: 9 }, (_, index) => index + 1).filter((digit) =>
    hasNote(mask, digit),
  );
}

export function toggleNote(notes, cell, digit) {
  const mask = noteMaskForDigit(digit);
  if (!mask || cell < 0 || cell >= 81) return notes;

  const next = [...notes];
  next[cell] ^= mask;
  return next;
}

export function clearCellNotes(notes, cell) {
  if (cell < 0 || cell >= 81 || notes[cell] === 0) return notes;

  const next = [...notes];
  next[cell] = 0;
  return next;
}

function sharesUnit(a, b) {
  const rowA = Math.floor(a / 9);
  const rowB = Math.floor(b / 9);
  const colA = a % 9;
  const colB = b % 9;
  const boxA = Math.floor(rowA / 3) * 3 + Math.floor(colA / 3);
  const boxB = Math.floor(rowB / 3) * 3 + Math.floor(colB / 3);
  return rowA === rowB || colA === colB || boxA === boxB;
}

export function applyDigitToNotes(notes, cell, digit) {
  const mask = noteMaskForDigit(digit);
  if (cell < 0 || cell >= 81) return notes;

  const next = [...notes];
  next[cell] = 0;

  if (!mask) return next;

  for (let index = 0; index < 81; index += 1) {
    if (index !== cell && sharesUnit(cell, index)) {
      next[index] &= ~mask;
    }
  }

  return next;
}
