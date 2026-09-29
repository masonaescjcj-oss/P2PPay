'use strict';

// Generates a new platform wallet mnemonic and prints its addresses.
// Run on a trusted machine, store the words offline, and give them to the server only as WALLET_MNEMONIC.
const { generateMnemonic, createKeyring } = require('../tron/keys');

const mnemonic = generateMnemonic();
const kr = createKeyring(mnemonic);
console.log(`
WALLET_MNEMONIC (24 words — write down offline, never commit, never share):

  ${mnemonic}

Hot wallet address (fund with TRX for fees and some USDT for withdrawals):
  ${kr.hotAddress}

Deposit addresses are derived per user (m/44'/195'/0'/0/<user id>), e.g. user 1:
  ${kr.depositAddress(1)}
`);
