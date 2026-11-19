#!/usr/bin/env node
'use strict';
// Writes users.json for the prototype (D-043). Passwords are stored only as scrypt hashes.
// Usage: node scripts/make-users.js [password]   (default demo password: custody-demo)
const crypto = require('crypto');
const fs = require('fs');
const path = require('path');

const pw = process.argv[2] || 'custody-demo';
const people = [
    { username: 'io.sharma', org: 'police', role: 'io', name: 'Insp. A. Sharma', designation: 'Police Inspector, Investigating Officer', badge: 'GJP-44821' },
    { username: 'malkhana.desai', org: 'police', role: 'malkhana', name: 'HC M. Desai', designation: 'Head Constable, Malkhana In-charge', badge: 'GJP-51907' },
    { username: 'examiner.mehta', org: 'fsl', role: 'examiner', name: 'Dr. K. Mehta', designation: 'Assistant Director, Questioned Documents', badge: 'FSL-GNR-0213' },
    { username: 'clerk.rao', org: 'court', role: 'court_clerk', name: 'S. Rao', designation: 'Property Clerk, CJM Court Gandhinagar', badge: 'CJM-GNR-77' },
];
const users = {};
for (const p of people) {
    const salt = crypto.randomBytes(16);
    const hash = crypto.scryptSync(pw, salt, 32);
    users[p.username] = { ...p, password: `scrypt$${salt.toString('hex')}$${hash.toString('hex')}` };
    delete users[p.username].username;
}
const out = path.join(__dirname, '..', 'users.json');
fs.writeFileSync(out, JSON.stringify(users, null, 2) + '\n');
console.log(`wrote ${out} (${people.length} users)`);
