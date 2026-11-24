function readOrder(member) {
  const raw = member?.member_order ?? member?.memberOrder;
  if (raw === null || raw === undefined || raw === '') return null;
  const value = Number(raw);
  return Number.isInteger(value) && value > 0 ? value : null;
}

function readName(member) {
  return String(member?.member_name || member?.name || member?.full_name || '').trim();
}

export function compareMembersByOrder(a, b) {
  const first = readOrder(a);
  const second = readOrder(b);
  if (first !== null && second !== null && first !== second) return first - second;
  if (first !== null && second === null) return -1;
  if (first === null && second !== null) return 1;
  return readName(a).localeCompare(readName(b), 'bn');
}

export function sortMembersByOrder(members = []) {
  return (Array.isArray(members) ? members : []).slice().sort(compareMembersByOrder);
}

export function moveMemberWithinOrder(members = [], membershipId, direction) {
  const rows = (Array.isArray(members) ? members : []).slice();
  const currentIndex = rows.findIndex((member) => member?.membership_id === membershipId);
  const offset = Math.sign(Number(direction) || 0);
  const nextIndex = currentIndex + offset;
  if (currentIndex < 0 || offset === 0 || nextIndex < 0 || nextIndex >= rows.length) return rows;
  [rows[currentIndex], rows[nextIndex]] = [rows[nextIndex], rows[currentIndex]];
  return rows;
}

export function hasMemberOrderChanged(members = [], savedMembershipIds = []) {
  const current = (Array.isArray(members) ? members : []).map((member) => String(member?.membership_id || ''));
  const saved = (Array.isArray(savedMembershipIds) ? savedMembershipIds : []).map((id) => String(id || ''));
  return current.length !== saved.length || current.some((id, index) => id !== saved[index]);
}
