'use strict';

// Staff roles and what each may do in the admin panel.
const ROLE_PERMS = {
  user: [],
  admin: ['funds', 'disputes', 'users', 'kyc', 'alerts', 'audit', 'staff', 'beta'],
  finance: ['funds', 'audit'],
  // beta: invite codes, tester feedback and error reports
  support: ['disputes', 'users', 'kyc', 'alerts', 'beta'],
};
const ROLES = Object.keys(ROLE_PERMS);
const STAFF_ROLES = ROLES.filter((r) => r !== 'user');
const permsOf = (role) => ROLE_PERMS[role] || [];

module.exports = { ROLE_PERMS, ROLES, STAFF_ROLES, permsOf };
