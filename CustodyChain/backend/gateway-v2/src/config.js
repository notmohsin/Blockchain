'use strict';
const path = require('path');

const BACKEND = path.resolve(__dirname, '../..');
const env = (k, d) => process.env[k] || d;
const NET = env('NETWORK_DIR', path.join(BACKEND, 'network-bft'));
const PEER_ORGS = path.join(NET, 'organizations', 'peerOrganizations');

const ORGS = {
    police: { msp: 'PoliceMSP', name: 'Police', peer: 'localhost:7051', host: 'peer0.police.custodychain.local' },
    fsl:    { msp: 'FSLMSP',    name: 'Forensic Science Laboratory', peer: 'localhost:8051', host: 'peer0.fsl.custodychain.local' },
    court:  { msp: 'CourtMSP',  name: 'Court', peer: 'localhost:9051', host: 'peer0.court.custodychain.local' },
};
for (const [k, o] of Object.entries(ORGS)) {
    const dom = `${k}.custodychain.local`;
    o.domain = dom;
    o.tlsCert = path.join(PEER_ORGS, dom, 'peers', `peer0.${dom}`, 'tls', 'ca.crt');
    o.usersDir = path.join(PEER_ORGS, dom, 'users');
}

module.exports = {
    PORT: Number(env('PORT', 4000)),
    CHANNEL: env('CHANNEL_NAME', 'custody'),
    CHAINCODE: env('CHAINCODE_NAME', 'evidence'),
    ORGS,
    SPEC_DIR: env('SPEC_DIR', path.resolve(BACKEND, '..', '..', 'outputs', 'spec')),
    STORE_DIR: env('EVIDENCE_STORE_DIR', path.join(BACKEND, 'evidence-store', 'data')),
    KEY_DIR: env('EVIDENCE_KEY_DIR', path.join(BACKEND, 'evidence-store', 'keys')),
    USERS_FILE: env('USERS_FILE', path.join(__dirname, '..', 'users.json')),
    SESSION_HOURS: Number(env('SESSION_HOURS', 8)),
    MAX_FILE_MB: Number(env('MAX_FILE_MB', 100)),
    // Police units: name -> evidence-ID prefix STATE-DISTRICT-UNIT (D-037; evidence_id format of the spec)
    UNITS: {
        'Cyber Crime Police Station Gandhinagar': 'GJ-GNR-CYBPS',
        'Sector 7 Police Station Gandhinagar': 'GJ-GNR-SEC7',
        'Navrangpura Police Station Ahmedabad': 'GJ-AHD-NAVPS',
    },
};
