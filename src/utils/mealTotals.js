/** Sum the three displayed meal components; safe when an RPC omits total_meals. */
export function getMealPartsTotal(meal) {
  return ['breakfast', 'lunch', 'dinner'].reduce((sum, key) => {
    const value = Number(meal?.[key] ?? 0);
    return sum + (Number.isFinite(value) ? value : 0);
  }, 0);
}
