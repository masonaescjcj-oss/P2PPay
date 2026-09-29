'use strict';

// TRON keys and addresses: BIP39 mnemonic → BIP32 (coin type 195) → secp256k1 → base58check.
const bip39 = require('@scure/bip39');
const { wordlist } = require('@scure/bip39/wordlists/english.js');
const { HDKey } = require('@scure/bip32');
const { secp256k1 } = require('@noble/curves/secp256k1.js');
const { keccak_256 } = require('@noble/hashes/sha3.js');
const { sha256 } = require('@noble/hashes/sha2.js');
const { base58check: makeBase58check } = require('@scure/base');

const b58 = makeBase58check(sha256);
const PREFIX = 0x41;

// Account 0 holds per-user deposit addresses (index = user id); account 1 is the hot wallet.
const depositPath = (index) => `m/44'/195'/0'/0/${index}`;
const HOT_PATH = "m/44'/195'/1'/0/0";

function addressFromPublicKey(pub) {
  const uncompressed = pub.length === 65 ? pub : secp256k1.Point.fromBytes(pub).toBytes(false);
  const hash = keccak_256(uncompressed.slice(1));
  const raw = new Uint8Array(21);
  raw[0] = PREFIX;
  raw.set(hash.slice(-20), 1);
  return b58.encode(raw);
}

function addressFromPrivateKey(priv) {
  return addressFromPublicKey(secp256k1.getPublicKey(priv, false));
}

function addressToBytes(address) {
  const raw = b58.decode(address);
  if (raw.length !== 21 || raw[0] !== PREFIX) throw new Error('invalid TRON address');
  return raw;
}

function isAddress(address) {
  try {
    addressToBytes(String(address));
    return true;
  } catch {
    return false;
  }
}

function generateMnemonic() {
  return bip39.generateMnemonic(wordlist, 256);
}

function createKeyring(mnemonic) {
  const phrase = String(mnemonic || '').trim().replace(/\s+/g, ' ');
  if (!bip39.validateMnemonic(phrase, wordlist)) throw new Error('WALLET_MNEMONIC is not a valid BIP39 mnemonic');
  const root = HDKey.fromMasterSeed(bip39.mnemonicToSeedSync(phrase));
  const derive = (path) => {
    const node = root.derive(path);
    return { privateKey: node.privateKey, address: addressFromPrivateKey(node.privateKey) };
  };
  const hot = derive(HOT_PATH);
  return {
    hotAddress: hot.address,
    hotKey: () => hot.privateKey,
    depositAddress: (index) => derive(depositPath(index)).address,
    depositKey: (index) => derive(depositPath(index)).privateKey,
  };
}

module.exports = {
  addressFromPublicKey, addressFromPrivateKey, addressToBytes, isAddress, generateMnemonic, createKeyring,
  depositPath, HOT_PATH,
};
