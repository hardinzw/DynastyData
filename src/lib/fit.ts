/** Ordinary least squares with an intercept. Returns [intercept, ...coefficients]. */
export function leastSquares(features: number[][], targets: number[]): number[] {
  const rows = features.map((f) => [1, ...f]);
  const size = rows[0]!.length;
  const matrix = Array.from({ length: size }, (_, i) => [
    ...Array.from({ length: size }, (_, j) => rows.reduce((sum, r) => sum + r[i]! * r[j]!, 0)),
    rows.reduce((sum, r, n) => sum + r[i]! * targets[n]!, 0),
  ]);
  for (let i = 0; i < size; i++) {
    let pivot = i;
    for (let k = i + 1; k < size; k++) if (Math.abs(matrix[k]![i]!) > Math.abs(matrix[pivot]![i]!)) pivot = k;
    [matrix[i], matrix[pivot]] = [matrix[pivot]!, matrix[i]!];
    if (matrix[i]![i] === 0) throw new Error("leastSquares: features are collinear");
    for (let k = 0; k < size; k++) {
      if (k === i) continue;
      const factor = matrix[k]![i]! / matrix[i]![i]!;
      for (let j = i; j <= size; j++) matrix[k]![j]! -= factor * matrix[i]![j]!;
    }
  }
  return matrix.map((r, i) => r[size]! / r[i]!);
}

/** The value at share `p` of the way through a list, 0-1. */
export function quantile(values: number[], p: number): number {
  const sorted = [...values].sort((a, b) => a - b);
  return sorted[Math.min(sorted.length - 1, Math.floor(sorted.length * p))]!;
}
