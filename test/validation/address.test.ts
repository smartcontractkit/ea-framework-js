import test from 'ava'
import {
  validateEthereumAddress,
  validateEthereumWithdrawalCredentials,
  validateBitcoinAddress,
  validateSolanaAddress,
} from '../../src/validation/address'

// --- Ethereum ---
test('invalid Ethereum address empty', (t) => {
  t.false(validateEthereumAddress(null))
  t.false(validateEthereumAddress(undefined))
  t.false(validateEthereumAddress(''))
})

test('valid Ethereum checksummed address', (t) => {
  t.true(validateEthereumAddress('0xd8dA6BF26964aF9D7eEd9e03E53415D37aA96045'))
})

test('valid Ethereum lowercase address', (t) => {
  t.true(validateEthereumAddress('0xd8da6bf26964af9d7eed9e03e53415d37aa96045'))
})

test('invalid Ethereum address (too short)', (t) => {
  t.false(validateEthereumAddress('0xd8dA6BF26964aF9D7eEd9e03E53415D37aA960'))
})

test('invalid Ethereum address (non-hex chars)', (t) => {
  t.false(validateEthereumAddress('0xGGGGGGGGGGGGGGGGGGGGGGGGGGGGGGGGGGGGGGGG'))
})

test('valid Ethereum address with correct EIP-55 checksum', (t) => {
  t.true(validateEthereumAddress('0x8288c280F35Fb8809305906C79BD075962079Dd8'))
})

test('invalid Ethereum address with incorrect EIP-55 checksum', (t) => {
  // Mixed case but wrong checksum — ethers rejects it
  t.false(validateEthereumAddress('0x8288C280F35Fb8809305906C79BD075962079Dd8'))
})

// --- Ethereum Withdrawal Credentials ---
test('valid 0x01 withdrawal credentials', (t) => {
  // 0x01 + 22 zero-padding chars + valid 40-char address
  t.true(
    validateEthereumWithdrawalCredentials(
      '0x010000000000000000000000d8dA6BF26964aF9D7eEd9e03E53415D37aA96045',
    ),
  )
})

test('valid 0x02 withdrawal credentials', (t) => {
  t.true(
    validateEthereumWithdrawalCredentials(
      '0x020000000000000000000000d8dA6BF26964aF9D7eEd9e03E53415D37aA96045',
    ),
  )
})

test('invalid withdrawal credentials - wrong prefix', (t) => {
  t.false(
    validateEthereumWithdrawalCredentials(
      '0x000000000000000000000000d8dA6BF26964aF9D7eEd9e03E53415D37aA96₀45',
    ),
  )
})

test('invalid withdrawal credentials - wrong length', (t) => {
  t.false(
    validateEthereumWithdrawalCredentials(
      '0x010000000000000000000000d8dA6BF26964aF9D7eEd9e03E53415D37aA9604',
    ),
  )
})

test('invalid withdrawal credentials - bad embedded address', (t) => {
  t.false(
    validateEthereumWithdrawalCredentials(
      '0x010000000000000000000000GGGGGGGGGGGGGGGGGGGGGGGGGGGGGGGGGGGGGGGG',
    ),
  )
})

// --- Bitcoin ---
test('valid P2PKH (legacy) Bitcoin address starting with 1', (t) => {
  t.true(validateBitcoinAddress('1BpEi6DfDAUFd153wiGrvkiKW1Y1zG4GQ9'))
})

test('valid P2SH Bitcoin address starting with 3', (t) => {
  t.true(validateBitcoinAddress('3J98t1WpEZ73CNmQviecrnyiWrnqRhWNLy'))
})

test('valid bech32 Bitcoin address (lowercase bc1)', (t) => {
  t.true(validateBitcoinAddress('bc1qar0srrr7xfkvy5l643lydnw9re59gtzzwf5mdq'))
})

test('uppercase BC1 bech32 Bitcoin address is rejected (prefix check is case-sensitive)', (t) => {
  t.false(validateBitcoinAddress('BC1QAR0SRRR7XFKVY5L643LYDNW9RE59GTZZWF5MDQ'))
})

test('invalid Bitcoin address - starts with 2', (t) => {
  t.false(validateBitcoinAddress('2N1fAFPUNDvnC4bPgMGJJvzgwKE7mGTKFRa'))
})

test('invalid Bitcoin address - base58 with invalid char O', (t) => {
  // 'O' is excluded from base58
  t.false(validateBitcoinAddress('1A1zP1eP5QGefi2DMPTfTL5SLmv7DivfOa'))
})

test('invalid Bitcoin bech32 - bc1 with invalid char b in payload', (t) => {
  // 'b' is not in the bech32 charset
  t.false(validateBitcoinAddress('bc1bxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx'))
})

test('valid base58 P2PKH Bitcoin address with digit 0 excluded', (t) => {
  // Base58 excludes 0, O, I, l — this valid address has none of those
  t.true(validateBitcoinAddress('1AnwDVbwsLBVwRfqN2x9Eo4YEJSPXo2cwG'))
})

test('invalid base58 Bitcoin address containing the character 0', (t) => {
  // '0' is not in the base58 alphabet
  t.false(validateBitcoinAddress('1AnwDVbwsLBVwRfqN2x9Eo4YEJSPXo2cw0'))
})

test('invalid base58 P2SH Bitcoin address containing the character 0', (t) => {
  t.false(validateBitcoinAddress('385cR5DM96n1HvBDMzLHPYcw89fZAXULJ0'))
})

test('valid bech32 Bitcoin address with uppercase letters in payload', (t) => {
  // Lowercase bc1 prefix is required; uppercase payload chars are accepted (isBech32 is case-insensitive)
  t.true(validateBitcoinAddress('bc1qar0SRRR7XFKVY5l643lydnw9re59gtzzwf5mdq'))
})

test('invalid bech32 Bitcoin address with "1" in payload', (t) => {
  // '1' is not in the bech32 charset (only the prefix separator, not the payload)
  t.false(validateBitcoinAddress('bc1qar0srrr7xfkvy5l643lydnw9re59gtzzwf5m11'))
})

// --- Solana ---
test('valid Solana address', (t) => {
  t.true(validateSolanaAddress('DhzWEu3gRUAeMxuRRmiU7hxjKgS8RKfajrGFPnWyku5Y'))
})

test('invalid Solana address - too short', (t) => {
  t.false(validateSolanaAddress('abc123'))
})

test('invalid Solana address - contains invalid base58 char', (t) => {
  t.false(validateSolanaAddress(`0OIl${'a'.repeat(40)}`))
})
