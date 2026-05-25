import test from 'ava'
import { validateAddress, AddressType } from '../../src/validation/address'

// --- null / empty inputs ---
test('returns false for null', (t) => {
  t.false(validateAddress(null, AddressType.ETHEREUM))
})

test('returns false for undefined', (t) => {
  t.false(validateAddress(undefined, AddressType.ETHEREUM))
})

test('returns false for empty string', (t) => {
  t.false(validateAddress('', AddressType.ETHEREUM))
})

// --- Ethereum ---
test('valid Ethereum checksummed address', (t) => {
  t.true(validateAddress('0xd8dA6BF26964aF9D7eEd9e03E53415D37aA96045', AddressType.ETHEREUM))
})

test('valid Ethereum lowercase address', (t) => {
  t.true(validateAddress('0xd8da6bf26964af9d7eed9e03e53415d37aa96045', AddressType.ETHEREUM))
})

test('invalid Ethereum address (too short)', (t) => {
  t.false(validateAddress('0xd8dA6BF26964aF9D7eEd9e03E53415D37aA960', AddressType.ETHEREUM))
})

test('invalid Ethereum address (non-hex chars)', (t) => {
  t.false(validateAddress('0xGGGGGGGGGGGGGGGGGGGGGGGGGGGGGGGGGGGGGGGG', AddressType.ETHEREUM))
})

test('valid Ethereum address with correct EIP-55 checksum', (t) => {
  t.true(validateAddress('0x8288c280F35Fb8809305906C79BD075962079Dd8', AddressType.ETHEREUM))
})

test('invalid Ethereum address with incorrect EIP-55 checksum', (t) => {
  // Mixed case but wrong checksum — ethers rejects it
  t.false(validateAddress('0x8288C280F35Fb8809305906C79BD075962079Dd8', AddressType.ETHEREUM))
})

// --- Ethereum Withdrawal Credentials ---
test('valid 0x01 withdrawal credentials', (t) => {
  // 0x01 + 22 zero-padding chars + valid 40-char address
  t.true(
    validateAddress(
      '0x010000000000000000000000d8dA6BF26964aF9D7eEd9e03E53415D37aA96045',
      AddressType.ETHEREUM_WITHDRAWAL_CREDENTIALS,
    ),
  )
})

test('valid 0x02 withdrawal credentials', (t) => {
  t.true(
    validateAddress(
      '0x020000000000000000000000d8dA6BF26964aF9D7eEd9e03E53415D37aA96045',
      AddressType.ETHEREUM_WITHDRAWAL_CREDENTIALS,
    ),
  )
})

test('invalid withdrawal credentials - wrong prefix', (t) => {
  t.false(
    validateAddress(
      '0x000000000000000000000000d8dA6BF26964aF9D7eEd9e03E53415D37aA96045',
      AddressType.ETHEREUM_WITHDRAWAL_CREDENTIALS,
    ),
  )
})

test('invalid withdrawal credentials - wrong length', (t) => {
  t.false(
    validateAddress(
      '0x010000000000000000000000d8dA6BF26964aF9D7eEd9e03E53415D37aA9604',
      AddressType.ETHEREUM_WITHDRAWAL_CREDENTIALS,
    ),
  )
})

test('invalid withdrawal credentials - bad embedded address', (t) => {
  t.false(
    validateAddress(
      '0x010000000000000000000000GGGGGGGGGGGGGGGGGGGGGGGGGGGGGGGGGGGGGGGG',
      AddressType.ETHEREUM_WITHDRAWAL_CREDENTIALS,
    ),
  )
})

// --- Bitcoin ---
test('valid P2PKH (legacy) Bitcoin address starting with 1', (t) => {
  t.true(validateAddress('1BpEi6DfDAUFd153wiGrvkiKW1Y1zG4GQ9', AddressType.BITCOIN))
})

test('valid P2SH Bitcoin address starting with 3', (t) => {
  t.true(validateAddress('3J98t1WpEZ73CNmQviecrnyiWrnqRhWNLy', AddressType.BITCOIN))
})

test('valid bech32 Bitcoin address (lowercase bc1)', (t) => {
  t.true(validateAddress('bc1qar0srrr7xfkvy5l643lydnw9re59gtzzwf5mdq', AddressType.BITCOIN))
})

test('uppercase BC1 bech32 Bitcoin address is rejected (prefix check is case-sensitive)', (t) => {
  t.false(validateAddress('BC1QAR0SRRR7XFKVY5L643LYDNW9RE59GTZZWF5MDQ', AddressType.BITCOIN))
})

test('invalid Bitcoin address - starts with 2', (t) => {
  t.false(validateAddress('2N1fAFPUNDvnC4bPgMGJJvzgwKE7mGTKFRa', AddressType.BITCOIN))
})

test('invalid Bitcoin address - base58 with invalid char O', (t) => {
  // 'O' is excluded from base58
  t.false(validateAddress('1A1zP1eP5QGefi2DMPTfTL5SLmv7DivfOa', AddressType.BITCOIN))
})

test('invalid Bitcoin bech32 - bc1 with invalid char b in payload', (t) => {
  // 'b' is not in the bech32 charset
  t.false(validateAddress('bc1bxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx', AddressType.BITCOIN))
})

test('valid base58 P2PKH Bitcoin address with digit 0 excluded', (t) => {
  // Base58 excludes 0, O, I, l — this valid address has none of those
  t.true(validateAddress('1AnwDVbwsLBVwRfqN2x9Eo4YEJSPXo2cwG', AddressType.BITCOIN))
})

test('invalid base58 Bitcoin address containing the character 0', (t) => {
  // '0' is not in the base58 alphabet
  t.false(validateAddress('1AnwDVbwsLBVwRfqN2x9Eo4YEJSPXo2cw0', AddressType.BITCOIN))
})

test('invalid base58 P2SH Bitcoin address containing the character 0', (t) => {
  t.false(validateAddress('385cR5DM96n1HvBDMzLHPYcw89fZAXULJ0', AddressType.BITCOIN))
})

test('valid bech32 Bitcoin address with uppercase letters in payload', (t) => {
  // Lowercase bc1 prefix is required; uppercase payload chars are accepted (isBech32 is case-insensitive)
  t.true(validateAddress('bc1qar0SRRR7XFKVY5l643lydnw9re59gtzzwf5mdq', AddressType.BITCOIN))
})

test('invalid bech32 Bitcoin address with "1" in payload', (t) => {
  // '1' is not in the bech32 charset (only the prefix separator, not the payload)
  t.false(validateAddress('bc1qar0srrr7xfkvy5l643lydnw9re59gtzzwf5m11', AddressType.BITCOIN))
})

// --- Solana ---
test('valid Solana address', (t) => {
  t.true(validateAddress('DhzWEu3gRUAeMxuRRmiU7hxjKgS8RKfajrGFPnWyku5Y', AddressType.SOLANA))
})

test('invalid Solana address - too short', (t) => {
  t.false(validateAddress('abc123', AddressType.SOLANA))
})

test('invalid Solana address - contains invalid base58 char', (t) => {
  t.false(validateAddress(`0OIl${'a'.repeat(40)}`, AddressType.SOLANA))
})
