export const SUPPORT_DEPARTMENTS = [
  'TECHNICAL_SUPPORT',
  'BILLING',
  'FEATURE_REQUEST',
  'ACCOUNT',
  'MANAGEMENT',
  'GENERAL',
];

export const SUPPORT_PRIORITIES = ['LOW', 'NORMAL', 'HIGH', 'URGENT'];

export const SUPPORT_STATUSES = ['OPEN', 'IN_PROGRESS', 'WAITING_FOR_USER', 'RESOLVED', 'CLOSED'];

export const USER_VISIBLE_STATUSES = SUPPORT_STATUSES;

export const ADMIN_ONLY_STATUSES = ['RESOLVED', 'CLOSED'];

export function isValidDepartment(v) {
  return SUPPORT_DEPARTMENTS.includes(String(v || '').trim().toUpperCase());
}

export function isValidPriority(v) {
  return SUPPORT_PRIORITIES.includes(String(v || '').trim().toUpperCase());
}

export function isValidStatus(v) {
  return SUPPORT_STATUSES.includes(String(v || '').trim().toUpperCase());
}

export function formatDepartmentLabel(v) {
  return String(v || '')
    .replace(/_/g, ' ')
    .toLowerCase()
    .replace(/\b\w/g, (c) => c.toUpperCase());
}
